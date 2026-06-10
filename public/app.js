document.addEventListener('DOMContentLoaded', () => {
    // ─── CẤU HÌNH ENDPOINT ĐẶC VỤ ──────────────────────────────────────────
    // Thay đổi thành '/chat' nếu file main.py của bạn khai báo @app.post("/chat")
    const AGENT_ENDPOINT = '/api/chat'; 

    // ─── KHỞI TẠO PHẦN TỬ DOM ──────────────────────────────────────────────
    const elements = {
        inputText:       document.getElementById('input-text'),
        submitBtn:       document.getElementById('submit-btn'),
        chatContainer:   document.getElementById('chat-container'),
        chatScroll:      document.getElementById('chat-scroll'),
        charCount:       document.getElementById('char-count'),
        processingBadge: document.getElementById('processing-badge'),
        welcomeScreen:   document.getElementById('welcome-screen'),
        userTpl:         document.getElementById('user-message-template'),
        stepsTpl:        document.getElementById('steps-block-template'),
        stepItemTpl:     document.getElementById('step-item-template'),
        aiTpl:           document.getElementById('ai-message-template')
    };

    // Kiểm tra an toàn xem có phần tử nào bị null do viết sai ID bên HTML không
    let hasError = false;
    for (const [key, el] of Object.entries(elements)) {
        if (!el) {
            console.error(`[LỖI GIAO DIỆN]: Không tìm thấy phần tử có ID hoặc cấu trúc phù hợp cho: "${key}"`);
            hasError = true;
        }
    }
    if (hasError) {
        alert("Giao diện đang thiếu một số thẻ ID quan trọng. Vui lòng nhấn F12 chọn tab Console để xem chi tiết!");
        return; // Dừng thực thi để tránh crash trang
    }

    let isProcessing = false;
    let currentStepsBlock = null; 
    let stepMap = {};

    // ─── SỰ KIỆN THEO DÕI ──────────────────────────────────────────────────
    
    // Cập nhật số lượng ký tự khi gõ
    elements.inputText.addEventListener('input', () => {
        elements.charCount.textContent = elements.inputText.value.length;
    });

    // Sự kiện Click chuột vào nút gửi
    elements.submitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        startAgentProcess();
    });

    // Sự kiện bấm tổ hợp phím Ctrl + Enter
    elements.inputText.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            e.preventDefault(); // Ngăn chặn hành vi xuống dòng mặc định
            startAgentProcess();
        }
    });

    // ─── LOGIC XỬ LÝ CHÍNH ─────────────────────────────────────────────────

    async function startAgentProcess() {
        const text = elements.inputText.value.trim();

        if (!text || isProcessing) return;

        // 1. Hiển thị tin nhắn của User lên màn hình
        if (elements.welcomeScreen && elements.welcomeScreen.parentNode) {
            elements.welcomeScreen.remove();
        }
        const userClone = elements.userTpl.content.cloneNode(true);
        userClone.querySelector('p').textContent = text;
        elements.chatContainer.appendChild(userClone);
        scrollBottom();

        // 2. Khóa form để tránh gửi lặp
        elements.inputText.value = '';
        elements.charCount.textContent = '0';
        isProcessing = true;
        elements.submitBtn.disabled = true;
        elements.processingBadge.classList.remove('hidden');

        // 3. Khởi tạo khối tiến trình (Steps Block) của Agent
        currentStepsBlock = createStepsBlock();
        stepMap = {};

        // 4. Tiến hành kết nối Stream dữ liệu từ Backend
        try {
            await streamAgent(text);
        } catch (err) {
            console.error(err);
            addAIMessage('Lỗi kết nối đặc vụ: ' + err.message);
            if (currentStepsBlock) {
                addStepItem(currentStepsBlock, 'error', 'Hệ thống', err.message);
            }
        } finally {
            isProcessing = false;
            elements.submitBtn.disabled = false;
            elements.processingBadge.classList.add('hidden');
            if (currentStepsBlock) markStepsBlockDone(currentStepsBlock);
        }
    }

    // ─── CÁC HÀM TRỢ GIÚP (HELPERS) ────────────────────────────────────────

    function scrollBottom() {
        elements.chatScroll.scrollTo({ top: elements.chatScroll.scrollHeight, behavior: 'smooth' });
    }

    function createStepsBlock() {
        const clone = elements.stepsTpl.content.cloneNode(true);
        const el       = clone.querySelector('.steps-block');
        const toggle   = clone.querySelector('.steps-toggle');
        const chevron  = clone.querySelector('.steps-chevron');
        const list     = clone.querySelector('.steps-list');
        const countEl  = clone.querySelector('.steps-count');
        const doneEl   = clone.querySelector('.steps-done-badge');

        toggle.addEventListener('click', () => {
            const open = !list.classList.contains('hidden');
            if (open) {
                list.classList.add('hidden');
                chevron.classList.remove('open');
            } else {
                list.classList.remove('hidden');
                chevron.classList.add('open');
            }
        });

        elements.chatContainer.appendChild(el);
        scrollBottom();

        const domEl = elements.chatContainer.lastElementChild;
        const domList    = domEl.querySelector('.steps-list');
        const domCountEl = domEl.querySelector('.steps-count');
        const domDoneEl  = domEl.querySelector('.steps-done-badge');
        const domChevron = domEl.querySelector('.steps-chevron');

        domList.classList.remove('hidden');
        domChevron.classList.add('open');

        return { el: domEl, list: domList, countEl: domCountEl, doneEl: domDoneEl, chevron: domChevron, count: 0 };
    }

    function addStepItem(block, status, name, msg) {
        const clone = elements.stepItemTpl.content.cloneNode(true);
        const item    = clone.querySelector('.step-item');
        const iconEl  = clone.querySelector('.step-icon');
        const nameEl  = clone.querySelector('.step-name');
        const msgEl   = clone.querySelector('.step-msg');

        nameEl.textContent = name;
        msgEl.textContent  = msg || '';
        setStepIcon(iconEl, status);

        block.list.appendChild(item);
        block.count++;
        block.countEl.textContent = block.count;
        scrollBottom();

        return block.list.lastElementChild;
    }

    function setStepIcon(iconEl, status) {
        if (status === 'running') {
            iconEl.innerHTML = '<div class="step-icon-spin"></div>';
        } else if (status === 'done') {
            iconEl.innerHTML = `<svg class="step-icon-done" width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 6.5L5 9L10.5 4" stroke="#10b981" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        } else if (status === 'error') {
            iconEl.innerHTML = `<svg class="step-icon-error" width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="#ef4444" stroke-width="1.3"/><path d="M4.5 4.5L8.5 8.5M8.5 4.5L4.5 8.5" stroke="#ef4444" stroke-width="1.3" stroke-linecap="round"/></svg>`;
        }
    }

    function markStepsBlockDone(block) {
        block.doneEl.classList.remove('hidden');
        block.doneEl.classList.add('inline-flex');
        setTimeout(() => {
            block.list.classList.add('hidden');
            block.chevron.classList.remove('open');
        }, 800);
    }

    function addAIMessage(text) {
        const clone = elements.aiTpl.content.cloneNode(true);
        const mdDiv = clone.querySelector('.markdown-body');
        
        if (typeof marked !== 'undefined') {
            mdDiv.innerHTML = marked.parse(text);
        } else {
            mdDiv.textContent = text;
        }

        if (typeof renderMathInElement !== 'undefined') {
            setTimeout(() => {
                renderMathInElement(mdDiv, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false}
                    ],
                    throwOnError: false
                });
            }, 0);
        }

        const wrapper  = clone.querySelector('.ai-message-wrapper');
        const copyBtn  = clone.querySelector('.copy-btn');
        const likeBtn  = clone.querySelector('.like-btn');
        const dislikeBtn = clone.querySelector('.dislike-btn');

        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(text).then(() => {
                const orig = copyBtn.innerHTML;
                copyBtn.innerHTML = `✔ Đã copy`;
                setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
            });
        });
        
        likeBtn.addEventListener('click', () => { likeBtn.classList.toggle('text-green-600'); dislikeBtn.classList.remove('text-red-500'); });
        dislikeBtn.addEventListener('click', () => { dislikeBtn.classList.toggle('text-red-500'); likeBtn.classList.remove('text-green-600'); });

        elements.chatContainer.appendChild(wrapper);
        scrollBottom();
    }

    // ─── ĐỌC VÀ PHÂN TÍCH STREAM TỪ SERVER ─────────────────────────────────

    async function streamAgent(text) {
        const response = await fetch(AGENT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || `Server Error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const cleanedLine = line.trim();
                if (!cleanedLine || !cleanedLine.startsWith('data: ')) continue;

                const jsonStr = cleanedLine.substring(6);
                try {
                    const data = JSON.parse(jsonStr);
                    const block = currentStepsBlock;

                    if (data.status === 'info') {
                        addStepItem(block, 'running', 'Khởi tạo', data.message);
                    } else if (data.status === 'step') {
                        const key = data.step_name;
                        if (!stepMap[key]) {
                            const itemEl  = addStepItem(block, 'running', data.step_name, data.message);
                            const iconEl  = itemEl.querySelector('.step-icon');
                            stepMap[key]  = { itemEl, iconEl };
                        } else {
                            stepMap[key].itemEl.querySelector('.step-msg').textContent = data.message;
                        }
                    } else if (data.status === 'step_complete') {
                        const key = data.step_name;
                        if (stepMap[key]) {
                            setStepIcon(stepMap[key].iconEl, 'done');
                            stepMap[key].itemEl.querySelector('.step-msg').textContent = data.message;
                        } else {
                            addStepItem(block, 'done', data.step_name, data.message);
                        }
                    } else if (data.status === 'complete') {
                        if (data.final_text) addAIMessage(data.final_text);
                        return;
                    } else if (data.status === 'error') {
                        const key = data.step_name || 'Lỗi';
                        if (stepMap[key]) {
                            setStepIcon(stepMap[key].iconEl, 'error');
                            stepMap[key].itemEl.querySelector('.step-msg').textContent = data.message;
                        } else {
                            addStepItem(block, 'error', key, data.message);
                        }
                        throw new Error(data.message);
                    }
                } catch (e) {
                    console.error("Lỗi phân tích JSON stream:", e);
                }
            }
        }
    }
});
