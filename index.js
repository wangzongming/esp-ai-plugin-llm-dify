// 保存会话ID
const sid = new Map([]);
 
module.exports = {
    // 插件名字
    name: "esp-ai-plugin-llm-dify",
    // 插件类型 LLM | TTS | IAT
    type: "LLM",
    main({ devLog, device_id, is_pre_connect, llm_config, text, llmServerErrorCb, llm_init_messages = [], llm_historys = [], cb, llm_params_set, logWSServer, connectServerBeforeCb, connectServerCb, log }) {
        try {
            const { api_key, url = 'https://api.dify.ai/v1', ...other_config } = llm_config;
            if (!api_key) return log.error(`请配置 LLM 的 api_key 参数。`);

            // 预请求处理
            async function preConnect() {
                // 预连接逻辑，可以为空
            }
            if (is_pre_connect) {
                preConnect();
                return;
            }

            // 消息关闭标志
            let shouldClose = false;
            // 文本结构定义（固定写法）
            const texts = {
                all_text: "",
                count_text: "",
                index: 0,
            }; 

            // 告诉框架要开始连接LLM服务了
            connectServerBeforeCb();

            async function main() {
                try {
                    // 构建请求headers
                    const headers = {
                        'Authorization': `Bearer ${api_key}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream',
                        'User-Agent': 'esp-ai-plugin-llm-dify-client/1.0.5'
                    }; 

                    // 构建请求体
                    const requestBody = {
                        inputs: {},
                        query: text,
                        response_mode: "streaming",
                        user: device_id,
                        conversation_id: sid.get(device_id),
                    };

                    // 处理历史消息（如果有）
                    if (llm_historys && llm_historys.length > 0) {
                        devLog && log.llm_info('添加历史消息，数量:', llm_historys.length);
                        // 如果Dify需要特定格式的历史消息，可以在这里转换
                        // 注意：根据Dify文档调整这部分
                    } 

                    // 确保URL格式正确（去除可能的尾部斜杠）
                    const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;

                    // 输出调试信息
                    devLog && log.llm_info('请求URL:', `${baseUrl}/chat-messages`);
                    devLog && log.llm_info('请求头:', JSON.stringify(headers));
                    devLog && log.llm_info('请求体:', JSON.stringify(requestBody));

                    // 发起请求
                    const response = await fetch(`${baseUrl}/chat-messages`, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(requestBody),
                        // 添加超时处理
                        timeout: other_config.timeout || 30000
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        log.error(`Dify API错误: ${response.status} ${response.statusText}`);
                        log.error(`错误详情: ${errorText}`);
                        log.error(`请求URL: ${baseUrl}/chat-messages`);
                        log.error(`请求体: ${JSON.stringify(requestBody)}`);
                        try {
                            const errorJson = JSON.parse(errorText);
                            log.error(`错误结构: ${JSON.stringify(errorJson)}`);
                        } catch (e) {
                            // 不是JSON格式，已经输出了原始文本
                        }
                        throw new Error(`Dify API错误: ${response.status} ${response.statusText}`);
                    }

                    // 通知框架已连接到LLM服务
                    connectServerCb(true);

                    // 注册关闭函数
                    const controller = new AbortController();
                    logWSServer({
                        close: () => {
                            connectServerCb(false);
                            controller.abort();
                            shouldClose = true;
                        }
                    });

                    // 处理流式响应
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let first_response = true;

                    while (true) {
                        if (shouldClose) break;

                        const { done, value } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value);
                        // 解析SSE格式的响应
                        const lines = chunk.split('\n').filter(line => line.trim() !== '');

                        for (const line of lines) {
                            if (line.startsWith('data:')) {
                                if (line.includes('[DONE]')) continue;

                                try {
                                    const data = JSON.parse(line.slice(5).trim());
                                    const chunk_text = data.answer || '';

                                    // 获取会话ID（通常在第一个响应中）
                                    if (first_response && data.conversation_id) { 
                                        first_response = false;
                                        devLog && log.llm_info('获取到新会话ID：',  data.conversation_id);
                                        sid.set(device_id,  data.conversation_id)
                                        // 通知框架保存会话ID
                                        cb({
                                            text,
                                            texts,
                                            chunk_text, 
                                        });
                                    } else {
                                        devLog === 2 && log.llm_info('LLM 输出：', chunk_text);
                                        texts["count_text"] += chunk_text;
                                        cb({ text, texts, chunk_text });
                                    }
                                } catch (e) {
                                    // 忽略解析错误
                                    devLog && log.error('解析响应出错：', e, line);
                                }
                            }
                        }
                    }

                    if (shouldClose) return;

                    // 通知框架响应结束，并传递会话ID
                    cb({
                        text,
                        is_over: true,
                        texts,
                        shouldClose, 
                    });

                    // 通知框架关闭了与LLM服务的连接
                    connectServerCb(false);

                    devLog && log.llm_info('===');
                    devLog && log.llm_info(texts["count_text"]);
                    devLog && log.llm_info('===');
                    devLog && log.llm_info('LLM connect close!\n'); 
                } catch (error) {
                    console.log('完整错误信息:', error);
                    llmServerErrorCb("Dify LLM 报错: " + (error.message || error));
                    connectServerCb(false);
                }
            }

            main();

        } catch (err) {
            console.log(err);
            log.error("Dify LLM 插件错误：", err);
            connectServerCb(false);
        }
    }
} 