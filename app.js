const chatList = document.getElementById('chatList');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const messageTemplate = document.getElementById('messageTemplate');
const historyList = document.getElementById('historyList');
const historyItemTemplate = document.getElementById('historyItemTemplate');
const newChatBtn = document.getElementById('newChatBtn');
const openSystemPrompt = document.getElementById('openSystemPrompt');
const systemPromptModal = document.getElementById('systemPromptModal');
const systemPromptInput = document.getElementById('systemPromptInput');
const saveSystemPrompt = document.getElementById('saveSystemPrompt');

const state = {
  conversations: [],
  activeConversationId: null,
  defaultSystemPrompt: 'You are a concise, helpful assistant.',
};

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }

  return data;
}

function getActiveConversation() {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId);
}

function updateConversationTitle(conversation) {
  const firstUser = conversation.messages.find((message) => message.role === 'user');
  if (firstUser) {
    conversation.title = firstUser.content.slice(0, 40) || 'Conversation';
  }
}

async function persistConversationTitle(conversation) {
  await apiRequest(`/api/conversations/${conversation.id}`, {
    method: 'PUT',
    body: JSON.stringify({ title: conversation.title }),
  });
}

function renderHistory() {
  historyList.innerHTML = '';

  state.conversations.forEach((conversation) => {
    const fragment = historyItemTemplate.content.cloneNode(true);
    const button = fragment.querySelector('.history-item');
    const title = fragment.querySelector('.history-title');
    const meta = fragment.querySelector('.history-meta');

    title.textContent = conversation.title;
    meta.textContent = `${conversation.messages.length} messages`;

    if (conversation.id === state.activeConversationId) {
      button.classList.add('active');
    }

    button.addEventListener('click', async () => {
      state.activeConversationId = conversation.id;
      const data = await apiRequest(`/api/conversations/${conversation.id}/messages`);
      conversation.messages = data.messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));
      renderConversation();
      renderHistory();
    });

    historyList.appendChild(fragment);
  });
}

function renderMessage(message, index) {
  const fragment = messageTemplate.content.cloneNode(true);
  const item = fragment.querySelector('.message');
  item.querySelector('.role').textContent = message.role;
  item.querySelector('.content').textContent = message.content;

  const regenerateBtn = item.querySelector('.regenerate-btn');
  if (message.role === 'assistant') {
    regenerateBtn.hidden = false;
    regenerateBtn.addEventListener('click', () => {
      regenerateFrom(index);
    });
  }

  chatList.appendChild(fragment);
}

function renderConversation() {
  const activeConversation = getActiveConversation();
  chatList.innerHTML = '';

  if (!activeConversation) {
    return;
  }

  activeConversation.messages.forEach((message, index) => renderMessage(message, index));
  chatList.scrollTop = chatList.scrollHeight;
}

function getPayload(messages, systemPrompt) {
  const payload = [];
  if (systemPrompt.trim()) {
    payload.push({ role: 'system', content: systemPrompt.trim() });
  }
  return [...payload, ...messages];
}

async function queryLLM(messages, systemPrompt) {
  const payload = getPayload(messages, systemPrompt);
  const data = await apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: payload }),
  });

  return data.reply ?? 'No reply returned by API.';
}

async function sendMessage() {
  const activeConversation = getActiveConversation();
  const text = userInput.value.trim();

  if (!activeConversation || !text) {
    return;
  }

  userInput.value = '';
  activeConversation.messages.push({ role: 'user', content: text });
  updateConversationTitle(activeConversation);
  renderConversation();
  renderHistory();

  sendBtn.disabled = true;
  sendBtn.textContent = 'Thinking…';

  try {
    await apiRequest(`/api/conversations/${activeConversation.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'user', content: text }),
    });

    await persistConversationTitle(activeConversation);

    const assistantReply = await queryLLM(activeConversation.messages, activeConversation.systemPrompt);
    activeConversation.messages.push({ role: 'assistant', content: assistantReply });

    await apiRequest(`/api/conversations/${activeConversation.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'assistant', content: assistantReply }),
    });
  } catch (error) {
    activeConversation.messages.push({ role: 'assistant', content: `Error: ${error.message}` });
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    renderConversation();
    renderHistory();
  }
}

async function regenerateFrom(assistantIndex) {
  const activeConversation = getActiveConversation();
  if (!activeConversation) {
    return;
  }

  const conversationBeforeAssistant = activeConversation.messages.slice(0, assistantIndex);
  activeConversation.messages = conversationBeforeAssistant;
  renderConversation();
  renderHistory();

  sendBtn.disabled = true;
  sendBtn.textContent = 'Regenerating…';

  try {
    await apiRequest(`/api/conversations/${activeConversation.id}/messages`, {
      method: 'PUT',
      body: JSON.stringify({ messages: activeConversation.messages }),
    });

    const assistantReply = await queryLLM(activeConversation.messages, activeConversation.systemPrompt);
    activeConversation.messages.push({ role: 'assistant', content: assistantReply });

    await apiRequest(`/api/conversations/${activeConversation.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'assistant', content: assistantReply }),
    });
  } catch (error) {
    activeConversation.messages.push({ role: 'assistant', content: `Error: ${error.message}` });
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    renderConversation();
    renderHistory();
  }
}

async function addNewConversation(makeActive = true) {
  const data = await apiRequest('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({
      title: 'New conversation',
      systemPrompt: state.defaultSystemPrompt,
    }),
  });

  const conversation = {
    id: data.conversation.id,
    title: data.conversation.title,
    systemPrompt: data.conversation.system_prompt,
    messages: [],
  };

  state.conversations.unshift(conversation);
  if (makeActive) {
    state.activeConversationId = conversation.id;
  }
  renderHistory();
  renderConversation();
}

async function loadInitialData() {
  const data = await apiRequest('/api/conversations');
  const conversations = data.conversations ?? [];

  if (!conversations.length) {
    await addNewConversation(true);
    return;
  }

  state.conversations = conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    systemPrompt: conversation.system_prompt,
    messages: [],
  }));

  state.activeConversationId = state.conversations[0].id;

  const active = getActiveConversation();
  if (active) {
    const messagesData = await apiRequest(`/api/conversations/${active.id}/messages`);
    active.messages = messagesData.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }

  renderHistory();
  renderConversation();
}

sendBtn.addEventListener('click', sendMessage);

userInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

newChatBtn.addEventListener('click', async () => {
  await addNewConversation(true);
  userInput.focus();
});

openSystemPrompt.addEventListener('click', () => {
  const activeConversation = getActiveConversation();
  systemPromptInput.value = activeConversation?.systemPrompt ?? state.defaultSystemPrompt;
  systemPromptModal.showModal();
});

saveSystemPrompt.addEventListener('click', async () => {
  const activeConversation = getActiveConversation();
  const promptValue = systemPromptInput.value.trim();

  if (!activeConversation) {
    return;
  }

  activeConversation.systemPrompt = promptValue;
  state.defaultSystemPrompt = promptValue || state.defaultSystemPrompt;

  await apiRequest(`/api/conversations/${activeConversation.id}`, {
    method: 'PUT',
    body: JSON.stringify({ systemPrompt: promptValue }),
  });

  renderHistory();
});

loadInitialData().catch((error) => {
  chatList.innerHTML = `<article class="message"><p class="content">Failed to load data: ${error.message}</p></article>`;
});
