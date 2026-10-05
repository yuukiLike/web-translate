# Edge TTS 本地服务

扩展默认使用系统英语语音。需要 Aria、Guy、Sonia 或 Ryan 的自然语音时，可以启动这个本地 MP3 服务。它复用 [edge-tts](https://github.com/rany2/edge-tts)，不需要安装 Edge 浏览器或填写微软 API Key。

需要 Python 3.11+。在仓库根目录执行：

```sh
python3 -m venv tools/edge-tts/.venv
tools/edge-tts/.venv/bin/python -m pip install -r tools/edge-tts/requirements.txt
tools/edge-tts/.venv/bin/python tools/edge-tts/server.py
```

在扩展「设置 → 阅读与英语发音」中选择 **Edge TTS**，填写终端显示的服务地址和访问令牌，点击「保存阅读偏好」并允许扩展访问本机服务。随后在划词浮层点击「朗读英语」。重新启动服务会生成新令牌，需要重新填写。

服务仅监听 `127.0.0.1`，每个请求都需要令牌；不保存文字或音频。选中的英语会发送给微软的在线语音服务。每次最多朗读 6,000 个字符，最多两个同时合成的请求，合成超时会返回错误。网络不可用时可以在设置中切换为系统语音。

可用 `--port 8766` 修改端口。扩展中的地址应相应填写 `http://127.0.0.1:8766/tts`。停止服务使用 `Ctrl+C`。

自有 HTTPS 服务也可填写为发音端点，需要接受带 `Authorization: Bearer <token>` 的 `POST` JSON `{ "text": "...", "voice": "en-US-AriaNeural", "rate": 1 }`，并返回 `Content-Type: audio/mpeg` 的 MP3。扩展拒绝重定向，并限制音频大小为 8 MB。
