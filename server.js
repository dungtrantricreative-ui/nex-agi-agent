const express = require('express');
const path = require('path');
const app = express();

// Cấu hình bắt buộc để đọc dữ liệu JSON gửi lên từ giao diện
app.use(express.json());

// Biến thư mục "public" thành đường dẫn "/static" trên web để sửa lỗi 404 file tĩnh
app.use('/static', express.static(path.join(__dirname, 'public')));

// Trả về file index.html khi truy cập trang chủ
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Hàm xử lý logic kết nối AI Đặc vụ
const handleHumanizeRequest = async (req, res) => {
    try {
        const { text, language } = req.body;

        // Thiết lập Header để truyền dữ liệu theo dạng cập nhật trạng thái liên tục (Stream)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Bước 1: Gửi tín hiệu khởi tạo lên giao diện
        res.write(`data: ${JSON.stringify({ status: 'info', message: 'Đã kết nối Backend Node.js thành công!' })}\n\n`);
        
        // Bước 2: Bật đèn xanh trạng thái "Xử lý Đặc vụ"
        res.write(`data: ${JSON.stringify({ status: 'step', step_name: 'Xử lý Đặc vụ', message: 'Đang kết nối tới mô hình AI qua Cloudflare Worker...' })}\n\n`);

        // ⚠️ CHÚ Ý: Thay link dưới đây bằng URL Cloudflare Worker thực tế của bạn
        const workerUrl = 'https://openrouter-api.YOUR_SUBDOMAIN.workers.dev/chat/completions';

        // Gọi sang Cloudflare Worker proxy (sử dụng model google/gemini-2.5-flash)
        const aiResponse = await fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                    { 
                        role: 'system', 
                        content: `Bạn là một chuyên gia hiệu đính văn bản. Hãy viết lại đoạn văn bản sau bằng ngôn ngữ được yêu cầu (${language}) sao cho tự nhiên, mượt mà như người thật viết và loại bỏ hoàn toàn các dấu vết văn phong của AI.` 
                    },
                    { role: 'user', content: text }
                ]
            })
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new Error(`Cloudflare Worker báo lỗi: ${aiResponse.status} - ${errorText}`);
        }

        // Đọc dữ liệu trả về từ OpenRouter thông qua Worker
        const aiData = await aiResponse.json();
        const aiText = aiData.choices?.[0]?.message?.content || 'Không nhận được phản hồi từ mô hình AI.';

        // Bước 3: Đánh dấu hoàn thành bước xử lý Đặc vụ
        res.write(`data: ${JSON.stringify({ status: 'step_complete', step_name: 'Xử lý Đặc vụ', message: 'Đã tối ưu hóa văn bản xong!' })}\n\n`);

        // Bước 4: Trả kết quả văn bản cuối cùng về bong bóng chat AI
        res.write(`data: ${JSON.stringify({ status: 'complete', final_text: aiText })}\n\n`);
        res.end();

    } catch (error) {
        console.error("Lỗi xử lý hệ thống:", error);
        // Nếu có bất kỳ sự cố nào, gửi trạng thái lỗi về giao diện để hiển thị dấu X đỏ
        res.write(`data: ${JSON.stringify({ status: 'error', step_name: 'Hệ thống', message: error.message })}\n\n`);
        res.end();
    }
};

// Hỗ trợ cả 2 endpoint để đảm bảo dù frontend gọi đường dẫn nào cũng không bị lỗi "Cannot POST"
app.post('/humanize', handleHumanizeRequest);
app.post('/api/chat', handleHumanizeRequest);

// Cấu hình PORT tự động cho Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Ứng dụng đang chạy mượt mà tại port ${PORT}`);
});
