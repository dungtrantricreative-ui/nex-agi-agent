document.addEventListener('DOMContentLoaded', () => {
    const inputText        = document.getElementById('input-text');
    const languageSelect   = document.getElementById('language-select');
    const humanizeBtn      = document.getElementById('humanize-btn');
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
    let currentStepsBlock = null;   // Cấu trúc lưu trữ: {el, list, countEl, count, doneEl}

    // ─── Hàm cuộn màn hình xuống cuối tin nhắn ──────────────────────────────
    function scrollBottom() {
        chatScroll.scrollTo({ top: chatScroll.scrollHeight, behavior: 'smooth' });
    }

    // ─── Ẩn màn hình chào mừng ban đầu ──────────────────────────────────────
    function hideWelcome() {
        if (welcomeScreen && welcomeScreen.parentNode) {
            welcomeScreen.remove();
        }
    }

    // ─── Đếm số lượng ký tự thời gian thực ──────────────────────────────────
    if (inputText) {
        inputText.addEventListener('input', () => {
            charCount.textContent = inputText.value.length;
        });
    }

    // ─── Thêm bong bóng chat của người dùng ─────────────────────────────────
    function addUserMessage(text) {
        hideWelcome();
        if (!userTpl) return;
        const clone = userTpl.content.cloneNode(true);
        clone.querySelector('p').textContent = text;
        chatContainer.appendChild(clone);
        scrollBottom();
    }

    // ─── Quản lý khối Header log chạy tool của AI ───────────────────────────
    function createStepsBlock() {
        if (!stepsTpl) return null;
        const clone = stepsTpl.content.cloneNode(true);
        const el       = clone.querySelector('.steps-block');
        const toggle   = clone.querySelector('.steps-toggle');
        const chevron  = clone.querySelector('.steps-chevron');
        const list     = clone.querySelector('.steps-list');
        const countEl  = clone.querySelector('.steps-count');
        const doneEl   = clone.querySelector('.steps-done-badge');

        if (toggle && list && chevron) {
            toggle.addEventListener('click', () => {
                const open = !list.classList.contains('hidden');
                if (open) {
                    list.classList.add('hidden');
                    chevron.classList.remove('rotate-90'); // Xoay mũi tên đóng
                } else {
                    list.classList.remove('hidden');
                    chevron.classList.add('rotate-90'); // Xoay mũi tên mở
                }
            });
        }

        chatContainer.appendChild(el);
        scrollBottom();

        const domEl = chatContainer.lastElementChild;
        const domList    = domEl.querySelector('.steps-list');
        const domCountEl = domEl.querySelector('.steps-count');
        const domDoneEl  = domEl.querySelector('.steps-done-badge');
        const domChevron = domEl.querySelector('.steps-chevron');

        if (domList && domChevron) {
            domList.classList.remove('hidden');
            domChevron.classList.add('rotate-90');
        }

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
        if (!block || !stepItemTpl) return null;
        const clone = stepItemTpl.content.cloneNode(true);
        const item    = clone.querySelector('.step-item');
        const iconEl  = clone.querySelector('.step-icon');
        const nameEl  = clone.querySelector('.step-name');
        const msgEl   = clone.querySelector('.step-msg');

        if (nameEl) nameEl.textContent = name;
        if (msgEl) msgEl.textContent  = msg || '';
        if (iconEl) setStepIcon(iconEl, status);

        block.list.appendChild(item);
        block.count++;
        if (block.countEl) block.countEl.textContent = block.count;
        scrollBottom();

        return block.list.lastElementChild;
    }

    function setStepIcon(iconEl, status) {
        if (!iconEl) return;
        if (status === 'running') {
            // Hiệu ứng Loading quay tròn đồng bộ
            iconEl.innerHTML = '<div class="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>';
        } else if (status === 'done') {
            iconEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        } else if (status === 'error') {
            iconEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
        }
    }

    function markStepsBlockDone(block) {
        if (!block) return;
        if (block.doneEl) {
            block.doneEl.classList.remove('hidden');
            block.doneEl.classList.add('inline-flex');
        }
        setTimeout(() => {
            if (block.list) block.list.classList.add('hidden');
            if (block.chevron) block.chevron.classList.remove('rotate-90');
        }, 800);
    }

    // ─── Bộ xử lý Stream Tin nhắn AI (Markdown + LaTeX + Trích xuất Link tải file) ───
    function initAIMessageStream() {
        if (!aiTpl) return null;
        const clone = aiTpl.content.cloneNode(true);
        chatContainer.appendChild(clone);
        scrollBottom();

        const domWrapper = chatContainer.lastElementChild;
        const mdDiv      = domWrapper.querySelector('.markdown-body');
        const copyBtn    = domWrapper.querySelector('.copy-btn');
        const likeBtn    = domWrapper.querySelector('.like-btn');
        const dislikeBtn = domWrapper.querySelector('.dislike-btn');

        let fullText = "";

        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(fullText).then(() => {
                    const orig = copyBtn.innerHTML;
                    copyBtn.innerHTML = "✓ Đã copy";
                    setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
                });
            });
        }
        if (likeBtn) {
            likeBtn.addEventListener('click', () => {
                likeBtn.classList.toggle('text-emerald-600');
                if (dislikeBtn) dislikeBtn.classList.remove('text-rose-500');
            });
        }
        if (dislikeBtn) {
            dislikeBtn.addEventListener('click', () => {
                dislikeBtn.classList.toggle('text-rose-500');
                if (likeBtn) likeBtn.classList.remove('text-emerald-600');
            });
        }

        return {
            // Ghi nhận ký tự đổ về từ stream và biên dịch Markdown theo thời gian thực
            writeChunk(text) {
                fullText += text;
                if (mdDiv) {
                    if (typeof marked !== 'undefined') {
                        mdDiv.innerHTML = marked.parse(fullText);
                    } else {
                        mdDiv.textContent = fullText;
                    }
                }
                scrollBottom();
            },
            // Chốt chặn cuối cùng: Xử lý LaTeX và gắn Nút Download thông minh
            finalize(finalText = null) {
                if (finalText !== null) fullText = finalText;
                
                if (mdDiv) {
                    // 1. Phân tích cú pháp Markdown
                    if (typeof marked !== 'undefined') {
                        mdDiv.innerHTML = marked.parse(fullText);
                    } else {
                        mdDiv.textContent = fullText;
                    }

                    // 2. Kích hoạt render công thức Toán LaTeX ($...$ hoặc $$...$$)
                    if (typeof renderMathInElement !== 'undefined') {
                        renderMathInElement(mdDiv, {
                            delimiters: [
                                {left: '$$', right: '$$', display: true},
                                {left: '$', right: '$', display: false},
                                {left: '\\(', right: '\\)', display: false},
                                {left: '\\[', right: '\\]', display: true}
                            ],
                            throwOnError: false
                        });
                    }

                    // 3. Tự động quyét tên file hệ thống để đính kèm Box tải tệp
                    const fileRegex = /([a-zA-Z0-9_\-\.]+\.(js|json|txt|html|css|py|md|xlsx|csv|docx|pdf|png|jpg))/gi;
                    const foundFiles = fullText.match(fileRegex);
                    
                    if (foundFiles && foundFiles.length > 0) {
                        const uniqueFiles = [...new Set(foundFiles)];
                        const downloadBox = document.createElement('div');
                        downloadBox.className = "mt-4 p-3.5 bg-slate-50 border border-slate-200/60 rounded-xl flex flex-col gap-2.5 animate-in";
                        
                        downloadBox.innerHTML = `
                            <div class="text-xs text-gray-500 font-medium flex items-center gap-1.5 select-none">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                                Tệp tin hệ thống đã sẵn sàng:
                            </div>
                            <div class="flex flex-wrap gap-2">
                                ${uniqueFiles.map(file => `
                                    <a href="/api/download?file=${encodeURIComponent(file)}" target="_blank" class="inline-flex items-center gap-2 bg-white hover:bg-gray-50 border border-gray-200 text-xs text-gray-800 font-medium px-3 py-1.5 rounded-lg transition shadow-sm font-mono hover:border-gray-300">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                        <span>${file}</span>
                                    </a>
                                `).join('')}
                            </div>
                        `;
                        mdDiv.appendChild(downloadBox);
                    }
                }
                scrollBottom();
            }
        };
    }

    let stepMap = {};

    // ─── Lắng nghe sự kiện click Gửi lệnh ───────────────────────────────────
    if (humanizeBtn) humanizeBtn.addEventListener('click', startHumanize);
    if (inputText) {
        inputText.addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 'Enter') startHumanize();
        });
    }

    async function startHumanize() {
        if (!inputText) return;
        const text     = inputText.value.trim();
        const language = languageSelect ? languageSelect.value : 'vi';

        if (!text) return;
        if (isProcessing) return;

        addUserMessage(text);
        inputText.value = '';
        if (charCount) charCount.textContent = '0';

        isProcessing = true;
        if (humanizeBtn) humanizeBtn.disabled = true;
        if (processingBadge) {
            processingBadge.classList.remove('hidden');
            processingBadge.classList.add('flex');
        }

        currentStepsBlock = createStepsBlock();
        stepMap = {};

        try {
            await streamHumanization(text, language);
        } catch (err) {
            console.error(err);
            const errStream = initAIMessageStream();
            if (errStream) {
                errStream.writeChunk('Lỗi kết nối đặc vụ: ' + err.message);
                errStream.finalize();
            }
            if (currentStepsBlock) {
                addStepItem(currentStepsBlock, 'error', 'Hệ thống', err.message);
            }
        } finally {
            isProcessing = false;
            if (humanizeBtn) humanizeBtn.disabled = false;
            if (processingBadge) {
                processingBadge.classList.add('hidden');
                processingBadge.classList.remove('flex');
            }
            if (currentStepsBlock) markStepsBlockDone(currentStepsBlock);
        }
    }

    // ─── Đọc Stream dữ liệu dòng chảy SSE từ Backend ────────────────────────
    async function streamHumanization(text, language) {
        const response = await fetch('/humanize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, language })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(errText || `Server Error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let aiStreamController = null;

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

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
                            const iconEl  = itemEl ? itemEl.querySelector('.step-icon') : null;
                            stepMap[key]  = { itemEl, iconEl };
                        } else {
                            const msgEl = stepMap[key].itemEl.querySelector('.step-msg');
                            if (msgEl) msgEl.textContent = data.message;
                        }

                    } else if (data.status === 'step_complete') {
                        const key = data.step_name;
                        if (stepMap[key]) {
                            setStepIcon(stepMap[key].iconEl, 'done');
                            const msgEl = stepMap[key].itemEl.querySelector('.step-msg');
                            if (msgEl) msgEl.textContent = data.message;
                        } else {
                            addStepItem(block, 'done', data.step_name, data.message);
                        }

                    } else if (data.status === 'chunk' || data.status === 'text') {
                        // KHI CÓ TOKEN CHỮ ĐỔ VỀ -> ĐẨY THẲNG RA MÀN HÌNH CHẠY CHỮ ĐỘNG (STREAMING)
                        if (!aiStreamController) {
                            aiStreamController = initAIMessageStream();
                        }
                        if (aiStreamController) {
                            aiStreamController.writeChunk(data.text || data.chunk || "");
                        }

                    } else if (data.status === 'complete') {
                        if (!aiStreamController) {
                            aiStreamController = initAIMessageStream();
                        }
                        if (aiStreamController) {
                            aiStreamController.finalize(data.final_text || null);
                        }
                        return;

                    } else if (data.status === 'error') {
                        const key = data.step_name || 'Lỗi';
                        if (stepMap[key]) {
                            setStepIcon(stepMap[key].iconEl, 'error');
                            const msgEl = stepMap[key].itemEl.querySelector('.step-msg');
                            if (msgEl) msgEl.textContent = data.message;
                        } else {
                            addStepItem(block, 'error', key, data.message);
                        }
                        throw new Error(data.message);
                    }
                } catch (e) {
                    console.error("Lỗi phân tích gói tin stream:", e);
                }
            }
        }
    }
});
