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

function createConversation() {
  const id = crypto.randomUUID();
  const createdAt = new Date();
  return {
    id,
    title: 'New conversation',
    createdAt,
    messages: [],
    systemPrompt: state.defaultSystemPrompt,
  };
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

    button.addEventListener('click', () => {
      state.activeConversationId = conversation.id;
      renderConversation();
      renderHistory();
    });

    historyList.appendChild(fragment);
  });
}

function renderMessage(message, index) {
  const activeConversation = getActiveConversation();
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

  if (!activeConversation) {
    return;
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

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: payload }),
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const data = await response.json();
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
    const assistantReply = await queryLLM(activeConversation.messages, activeConversation.systemPrompt);
    activeConversation.messages.push({ role: 'assistant', content: assistantReply });
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
    const assistantReply = await queryLLM(activeConversation.messages, activeConversation.systemPrompt);
    activeConversation.messages.push({ role: 'assistant', content: assistantReply });
  } catch (error) {
    activeConversation.messages.push({ role: 'assistant', content: `Error: ${error.message}` });
  } finally {
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    renderConversation();
    renderHistory();
  }
}

function addNewConversation(makeActive = true) {
  const conversation = createConversation();
  state.conversations.unshift(conversation);
  if (makeActive) {
    state.activeConversationId = conversation.id;
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

newChatBtn.addEventListener('click', () => {
  addNewConversation(true);
  userInput.focus();
});

openSystemPrompt.addEventListener('click', () => {
  const activeConversation = getActiveConversation();
  systemPromptInput.value = activeConversation?.systemPrompt ?? state.defaultSystemPrompt;
  systemPromptModal.showModal();
});

saveSystemPrompt.addEventListener('click', () => {
  const activeConversation = getActiveConversation();
  const promptValue = systemPromptInput.value.trim();

  if (activeConversation) {
    activeConversation.systemPrompt = promptValue;
  }

  state.defaultSystemPrompt = promptValue || state.defaultSystemPrompt;
  renderHistory();
});

addNewConversation(true);
