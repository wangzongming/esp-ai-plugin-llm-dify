const axios = require('axios');

module.exports = {
    // 插件名字
    name: "esp-ai-plugin-llm-dify",
    // 插件类型 LLM | TTS | IAT
    type: "LLM",
    main({ devLog, device_id, is_pre_connect, llm_config, text, llmServerErrorCb, llm_init_messages = [], llm_historys = [], cb, llm_params_set, logWSServer, connectServerBeforeCb, connectServerCb, log }) {
        try {

            const { api_key, url, ...other_config } = llm_config;

            if (!api_key) return log.error(`请配给 LLM 配置 api_key 参数。`)
            if (!url) return log.error(`请配给 LLM 配置 url 参数。`)


            // 预先连接函数
            async function preConnect() {

            }
            if (is_pre_connect) {
                preConnect()
                return;
            }

            let shouldClose = false;

            const texts = {
                all_text: "",
                count_text: "",
                index: 0
            };

            async function main() {
                try {
                    connectServerBeforeCb();

                    const requestData = {
                        inputs: {},
                        ...other_config,
                        query: text,
                        response_mode: "streaming",
                        user: device_id
                    };

                    const decoder = new TextDecoder();
                    axios.post(`${url}/chat-messages`, llm_params_set ? llm_params_set(requestData) : requestData, {
                        responseType: 'stream',
                        headers: {
                            'Authorization': `Bearer ${api_key}`,
                            'Content-Type': 'application/json'
                        }
                    })
                        .then(response => {
                            response.data.on("data", (dataChunk) => {
                                const chunk = decoder.decode(dataChunk);
                                const lines = chunk.split('\n\n').filter(line => line.trim());
                                for (const line of lines) {
                                    if (line.startsWith('data: ')) {
                                        try {
                                            const data = JSON.parse(line.slice(6));
                                            switch (data.event) {
                                                case 'agent_message':
                                                case 'message':
                                                    if (data.answer) {
                                                        // 固定写法，将 llm 推理出来的片段加到 texts.count_text
                                                        texts.count_text += data.answer.replace(/\\n/g, '');
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
                                            devLog && log.error('Parse chunk error:' + error);
                                        }
                                    }
                                }

                            });

                            response.data.on("end", (end) => {
                                // console.log(end, "end");
                                // 数据接收完毕的处理逻辑
                            });

                            response.data.on("error", (error) => {
                                // 流处理过程中发生错误的处理逻辑
                            });
                        })
                        .catch(error => {
                            console.error('Error:', error.response ? error.response.data : error.message);
                            llmServerErrorCb(`Dify LLM 错误: ${error.response ? error.response.data : error.message}`);
                            connectServerCb(false);
                        });

                    logWSServer({
                        close() {
                            shouldClose = true;
                        }
                    })

                    // 固定写法，告诉框架连接关闭了
                    connectServerCb(false);
                    devLog && log.llm_info('LLM connect close!\n');

                } catch (error) {
                    llmServerErrorCb(`Dify LLM 错误: ${error.message}`);
                    connectServerCb(false);
                }
            }

            main();

        } catch (err) {
            console.log(err);
            log.error("dify 插件错误：" + err)
            connectServerCb(false);
        }

    }
}
