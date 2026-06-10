document.addEventListener('DOMContentLoaded', () => {
    const inputText        = document.getElementById('input-text');
    const submitBtn        = document.getElementById('submit-btn');
    const chatContainer    = document.getElementById('chat-container');
    const chatScroll       = document.getElementById('chat-scroll');
    const charCount        = document.getElementById('char-count');
    const processingBadge  = document.getElementById('processing-badge');
    const welcomeScreen    = document.getElementById('welcome-screen');
    const userTpl          = document.getElementById('user-message-template');
    const stepsTpl         = document.getElementById('steps-block-template');
    const stepItemTpl      = document.getElementById('step-item-template');
    const aiTpl            = document.getElementById('ai-message-template');

    let isProcessing = false;
    let currentStepsBlock = null;   // {el, list, countEl, count, doneEl}

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function scrollBottom() {
        chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: 'smooth' });
    }

    // Xóa màn hình chào mừng khi có tin nhắn đầu tiên
    function hideWelcome() {
        if (welcomeScreen && welcomeScreen.parentNode) {
            welcomeScreen.remove();
        }
    }

    // ─── Đếm số ký tự nhập vào ───────────────────────────────────────────────

    inputText.addEventListener('input', () => {
        charCount.textContent = inputText.value.length;
    });

    // ─── Thêm tin nhắn của User vào giao diện ────────────────────────────────

    function addUserMessage(text) {
        hideWelcome();
        const clone = userTpl.content.cloneNode(true);
        clone.querySelector('p').textContent = text;
        chatContainer.appendChild(clone);
        scrollBottom();
    }

    // ─── Tạo khối hiển thị các bước thực thi lệnh (Agent Commands Block) ──────

    function createStepsBlock() {
        const clone = stepsTpl.content.cloneNode(true);
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

        chatContainer.appendChild(el);
        scrollBottom();

        const domEl = chatContainer.lastElementChild;
        const domList    = domEl.querySelector('.steps-list');
        const domCountEl = domEl.querySelector('.steps-count');
        const domDoneEl  = domEl.querySelector('.steps-done-badge');
        const domChevron = domEl.querySelector('.steps-chevron');

        domList.classList.remove('hidden');
        domChevron.classList.add('open');

        return {
            el: domEl,
            list: domList,
            countEl: domCountEl,
            doneEl: domDoneEl,
            chevron: domChevron,
            count: 0
        };
    }

    function addStepItem(block, status, name, msg) {
        const clone = stepItemTpl.content.cloneNode(true);
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

    // ─── Thêm phản hồi của AI vào giao diện ───────────────────────────────────

    function addAIMessage(text) {
        const clone = aiTpl.content.cloneNode(true);
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
                copyBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2.5 6.5L5 9L10.5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Đã copy`;
                setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
            });
        });
        likeBtn.addEventListener('click', () => {
            likeBtn.classList.toggle('text-green-600');
            dislikeBtn.classList.remove('text-red-500');
        });
        dislikeBtn.addEventListener('click', () => {
            dislikeBtn.classList.toggle('text-red-500');
            likeBtn.classList.remove('text-green-600');
        });

        chatContainer.appendChild(wrapper);
        scrollBottom();
    }

    // ─── Bản đồ lưu vết các tiến trình chạy tác vụ ──────────────────────────────
    let stepMap = {};

    // ─── Trình xử lý hành động gửi lệnh ────────────────────────────────────────

    submitBtn.addEventListener('click', startAgentProcess);
    inputText.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 'Enter') startAgentProcess();
    });

    async function startAgentProcess() {
        const text = inputText.value.trim();

        if (!text) return;
        if (isProcessing) return;

        addUserMessage(text);
        inputText.value = '';
        charCount.textContent = '0';

        isProcessing = true;
        submitBtn.disabled = true;
        
        // Hiển thị thanh trạng thái xử lý dữ liệu của hệ thống
        processingBadge.classList.remove('hidden');

        currentStepsBlock = createStepsBlock();
        stepMap = {};

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
            submitBtn.disabled = false;
            
            // Ẩn thanh trạng thái xử lý dữ liệu khi kết thúc hoàn toàn
            processingBadge.classList.add('hidden');
            
            if (currentStepsBlock) markStepsBlockDone(currentStepsBlock);
        }
    }

    // GỌI STREAM ĐẶC VỤ AI QUA POST FETCH STREAM
    async function streamAgent(text) {
        // Đổi đường dẫn thành endpoint bạn khai báo trong mã backend Python (ví dụ: '/api/chat' hoặc '/chat')
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
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
            
            // Giữ lại dòng dang dở cuối cùng vào bộ đệm buffer
            buffer = lines.pop();

            for (const line of lines) {
                const cleanedLine = line.trim();
                if (!cleanedLine || !cleanedLine.startsWith('data: ')) continue;

                const jsonStr = cleanedLine.substring(6); // Loại bỏ "data: " để lấy JSON
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
                        if (data.final_text) {
                            addAIMessage(data.final_text);
                        }
                        return; // Xử lý kết thúc thành công

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
                    console.error("Lỗi phân tích gói dữ liệu JSON stream:", e);
                }
            }
        }
    }
});
