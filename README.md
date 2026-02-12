# ChatBot (Frontend + Backend)

## Run locally (no Docker)
```bash
python3 server.py
```

Then open `http://localhost:8000`.

## Run with Docker Compose
```bash
docker compose up --build
```

Then open `http://localhost:8000`.

The SQLite database is persisted in a named Docker volume (`chatbot_data`) and mounted to `/app/data/chatbot.db`.

## Database
The backend stores conversations/messages in SQLite at `chatbot.db`.

## LLM backend configuration
Set these environment variables to use a real model endpoint:

- `LLM_API_KEY` (required for real calls)
- `LLM_API_URL` (optional, defaults to OpenAI chat completions endpoint)
- `LLM_MODEL` (optional, defaults to `gpt-4o-mini`)

Example:
```bash
export LLM_API_KEY=your_key
export LLM_MODEL=gpt-4o-mini
python3 server.py
```

Or with Docker Compose:
```bash
LLM_API_KEY=your_key LLM_MODEL=gpt-4o-mini docker compose up --build
```

If `LLM_API_KEY` is missing, backend returns a mock assistant reply so the app remains usable.
