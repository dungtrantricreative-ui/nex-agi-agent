const express = require('express');
const path = require('path');
const app = express();

// Cấu hình bắt buộc để Express đọc được dữ liệu JSON gửi từ giao diện lên
app.use(express.json());

// Sửa lỗi 404 bằng cách ánh xạ thư mục tĩnh "public" thành tiền tố "/static" trên URL
app.use('/static', express.static(path.join(__dirname, 'public')));

// Trả về giao diện index.html khi người dùng truy cập trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Hàm điều phối trung tâm kết nối với Đặc vụ AI
const handleHumanizeRequest = async (req, res) => {
    try {
        const { text, language } = req.body;

        // Thiết lập các Header để bật chế độ truyền dữ liệu cập nhật trạng thái liên tục (Stream SSE)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Bước 1: Phát tín hiệu kết nối thành công tới giao diện
        res.write(`data: ${JSON.stringify({ status: 'info', message: 'Đã kết nối Backend Node.js thành công!' })}\n\n`);
        
        // Bước 2: Bật trạng thái xử lý đặc vụ
        res.write(`data: ${JSON.stringify({ status: 'step', step_name: 'Xử lý Đặc vụ', message: 'Đang kết nối tới mô hình nex-agi/nex-n2-pro:free qua Cloudflare...' })}\n\n`);

        // ĐỊA CHỈ WORKER THỰC TẾ CỦA BẠN
        const workerUrl = 'https://openrouter-api.dungtrantricreative.workers.dev/v1/chat/completions';

        // Gọi API qua Cloudflare Worker proxy đến OpenRouter
        const aiResponse = await fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'nex-agi/nex-n2-pro:free', // Sử dụng mô hình bạn yêu cầu
                messages: [
                    { 
                        role: 'system', 
                        content: `Bạn là một chuyên gia hiệu đính văn bản. Hãy viết lại đoạn văn bản sau bằng ngôn ngữ được yêu cầu (${language}) sao cho tự nhiên, mượt mà như người thật viết và loại bỏ hoàn toàn các dấu vết văn phong của AI.` 
                    },
                    { role: 'user', content: text }
                ]
            })
        });

        // Kiểm tra xem Cloudflare Worker có trả về lỗi hay không
        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new Error(`Cloudflare Worker phản hồi lỗi: ${aiResponse.status} - ${errorText}`);
        }

        // Bóc tách dữ liệu JSON nhận được từ mô hình AI
        const aiData = await aiResponse.json();
        const aiText = aiData.choices?.[0]?.message?.content || 'Không nhận được nội dung phản hồi từ mô hình AI.';

        // Bước 3: Đóng trạng thái xử lý đặc vụ (Hiển thị tích xanh trên giao diện)
        res.write(`data: ${JSON.stringify({ status: 'step_complete', step_name: 'Xử lý Đặc vụ', message: 'Đã tối ưu hóa văn bản xong!' })}\n\n`);

        // Bước 4: Đẩy toàn bộ nội dung văn bản hoàn chỉnh vào bong bóng chat AI
        res.write(`data: ${JSON.stringify({ status: 'complete', final_text: aiText })}\n\n`);
        res.end();

    } catch (error) {
        console.error("Lỗi xử lý hệ thống:", error);
        // Khi xảy ra sự cố (hết chìa khóa API, lỗi mạng...), gửi tín hiệu báo lỗi để giao diện hiển thị dấu X đỏ
        res.write(`data: ${JSON.stringify({ status: 'error', step_name: 'Hệ thống', message: error.message })}\n\n`);
        res.end();
    }
};

// Map cả 2 endpoint nhằm tương thích tuyệt đối với mọi phiên bản gọi từ app.js
app.post('/humanize', handleHumanizeRequest);
app.post('/api/chat', handleHumanizeRequest);

// Thiết lập cổng lắng nghe tự động đồng bộ theo cơ chế của Render.com
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Ứng dụng hoạt động mượt mà tại port ${PORT}`);
});
