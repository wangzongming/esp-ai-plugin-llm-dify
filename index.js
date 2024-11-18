 
module.exports = {
    // 插件名字
    name: "esp-ai-plugin-llm-dify",
    // 插件类型 LLM | TTS | IAT
    type: "LLM",
    main({ devLog, device_id, llm_config, text, llmServerErrorCb, llm_init_messages = [], llm_historys = [], cb, llm_params_set, logWSServer, connectServerBeforeCb, connectServerCb, log }) {
        try {

            const { api_key, url, timeout = 6000, max_retries = 3, ...other_config } = llm_config;

            if (!api_key) return log.error(`请配给 LLM 配置 api_key 参数。`)
            if (!url) return log.error(`请配给 LLM 配置 url 参数。`)
  
            let shouldClose = false;
            let retryCount = 0;
 
            const texts = {
                all_text: "",
                count_text: "",
                index: 0
            };
 
            const handleError = (status) => {
                const errorMessages = {
                    400: "参数错误或应用不可用",
                    404: "对话不存在",
                    413: "文件太大",
                    415: "不支持的文件类型",
                    500: "服务器内部错误",
                    503: "服务暂时不可用"
                };
                return errorMessages[status] || `未知错误 (${status})`;
            };
 
            async function main() {
                try {
                    connectServerBeforeCb();

                    // 准备请求数据
                    const requestData = {
                        query: text,
                        user: device_id,
                        response_mode: "streaming",
                        conversation_id: "",
                        inputs: {},
                        ...other_config,
                        messages: [
                            ...llm_init_messages,
                            ...llm_historys,
                            { role: "user", content: text }
                        ]
                    };

                    // 创建 AbortController 用于超时控制
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeout);

                    // 发送请求
                    const response = await fetch(`${url}/chat-messages`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${api_key}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(llm_params_set ? llm_params_set(requestData) : requestData),
                        signal: controller.signal
                    });

                    clearTimeout(timeoutId);

                    if (!response.ok) {
                        throw new Error(handleError(response.status));
                    }

                    // 告诉 ESP-AI 框架已经连接上了服务了
                    connectServerCb(true);

                    // 向框架注册服务关闭处理器
                    logWSServer({
                        close: () => {
                            connectServerCb(false);
                            shouldClose = true;
                            controller.abort();
                        }
                    });

                    // 这里根据不同的服务要求来解析返回即可 
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();

                    while (true) {
                        if (shouldClose) break;

                        const { done, value } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value);
                        const lines = chunk.split('\n\n').filter(line => line.trim());

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                try {
                                    const data = JSON.parse(line.slice(6));

                                    switch (data.event) {
                                        case 'message':
                                            if (data.answer) {
                                                // 固定写法，将 llm 推理出来的片段加到 texts.count_text
                                                texts.count_text += data.answer;
                                                devLog === 2 && log.llm_info('LLM 输出：', data.answer);
                                                // 固定写法，将 llm 推理出来的片段递交给框架
                                                cb({ text, texts, chunk_text: data.answer });
                                            }
                                            break;

                                        case 'message_end':
                                            if (!shouldClose) {
                                                // 固定写法，将 llm 推理出来的片段递交给框架
                                                cb({
                                                    text,
                                                    is_over: true,
                                                    texts,
                                                    metadata: data.metadata
                                                });
                                            }
                                            break;

                                        case 'error':
                                            throw new Error(data.message);

                                        case 'message_file':
                                            // 处理文件类型消息
                                            if (data.type === 'image') {
                                                cb({
                                                    text,
                                                    texts,
                                                    file: {
                                                        type: 'image',
                                                        url: data.url
                                                    }
                                                });
                                            }
                                            break;
                                    }
                                } catch (error) {
                                    devLog && log.error('Parse chunk error:', error);
                                }
                            }
                        }
                    }
                    
                    // 固定写法，告诉框架连接关闭了
                    connectServerCb(false); 
                    devLog && log.llm_info('LLM connect close!\n');

                } catch (error) {
                    if (error.name === 'AbortError') {
                        llmServerErrorCb("请求超时");
                    } else if (retryCount < max_retries) {
                        retryCount++;
                        devLog && log.llm_info(`重试第 ${retryCount} 次`);
                        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                        return streamCompletion();
                    } else {
                        llmServerErrorCb(`Dify LLM 错误: ${error.message}`);
                    }
                    connectServerCb(false);
                }
            }
 
            main();
 
        } catch (err) {
            console.log(err);
            log.error("dify 插件错误：", err)
            connectServerCb(false);
        }

    }
}
