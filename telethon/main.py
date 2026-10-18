import os
import re

from fastapi import FastAPI, HTTPException, Query
from telethon import TelegramClient
from telethon.tl.functions.channels import InviteToChannelRequest
from telethon.tl.functions.messages import AddChatUserRequest, ForwardMessagesRequest

# Credentials are read from the environment. The session file is created on the
# first login and must never be committed to the repository.
api_id = int(os.environ.get("TELEGRAM_API_ID", "0"))
api_hash = os.environ.get("TELEGRAM_API_HASH", "")
session_name = os.environ.get("TELETHON_SESSION_NAME", "userbot")

client = TelegramClient(session_name, api_id, api_hash)
app = FastAPI()


@app.on_event("startup")
async def startup():
    await client.start()
    print("Telethon client started.")

@app.post("/invite_bot_to_chat")
async def invite_bot_to_chat(
    bot_username: str = Query(..., description="username бота (без @)"),
    chat_id: int = Query(..., description="ID чата (группы или канала)")
):
    print(f"Inviting bot {bot_username} to chat {chat_id}")
    try:
        # username должен быть без @
        if bot_username.startswith("@"):  # убираем @ если есть
            bot_username = bot_username[1:]
        entity = await client.get_entity(bot_username)
        chat = await client.get_entity(chat_id)
        # Определяем тип чата
        if hasattr(chat, 'megagroup') or hasattr(chat, 'broadcast'):
            # Канал или супергруппа
            await client(InviteToChannelRequest(chat, [entity]))
        else:
            # Обычная группа
            await client(AddChatUserRequest(chat_id=chat.id, user_id=entity, fwd_limit=10))
        return {"status": "ok"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}

def parse_t_me_link(link: str):
    # Проверяем приватный формат
    match = re.match(r'https?://t\.me/c/(\d+)/(\d+)', link)
    if match:
        chat_id = int(match.group(1))
        message_id = int(match.group(2))
        full_chat_id = -1000000000000 + chat_id  # корректируем chat_id для приватных
        return full_chat_id, message_id

    # Проверяем публичный формат
    match = re.match(r'https?://t\.me/([\w\d_]+)/(\d+)', link)
    if match:
        username = match.group(1)
        message_id = int(match.group(2))
        return username, message_id

    raise ValueError("Invalid t.me link format")

@app.post("/forward_message")
async def forward_message(
    from_chat_id: int = Query(..., description="ID чата, из которого пересылать сообщение"),
    message_id: int = Query(..., description="ID сообщения для пересылки"),
    to_chat_id: int = Query(..., description="ID чата, куда переслать сообщение")
):
    try:
        # Получаем entity для обоих чатов
        from_entity = await client.get_entity(from_chat_id)
        to_entity = await client.get_entity(to_chat_id)
        # Пересылаем сообщение
        result = await client(ForwardMessagesRequest(
            from_peer=from_entity,
            id=[message_id],
            to_peer=to_entity,
            with_my_score=False
        ))
        # result.updates[0].message.id — айди пересланного сообщения
        # result.updates может содержать разные типы, ищем MessageID
        forwarded_id = None
        for update in result.updates:
            if hasattr(update, 'message') and hasattr(update.message, 'id'):
                forwarded_id = update.message.id
                break
        if not forwarded_id:
            # Иногда это может быть UpdateNewMessage
            for update in result.updates:
                if hasattr(update, 'message') and hasattr(update.message, 'id'):
                    forwarded_id = update.message.id
                    break
        if not forwarded_id:
            raise HTTPException(status_code=500, detail="Не удалось получить id пересланного сообщения")
        return {"forwarded_message_id": forwarded_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка при пересылке: {e}")

@app.post("/send_message_to_bot")
async def send_message_to_bot(
    bot_username: str = Query(..., description="username бота (без @)"),
    text: str = Query("test", description="Текст сообщения")
):
    try:
        # username должен быть без @
        if bot_username.startswith("@"):  # убираем @ если есть
            bot_username = bot_username[1:]
        entity = await client.get_entity(bot_username)
        sent = await client.send_message(entity, text)
        return {"status": "ok", "message_id": sent.id}
    except Exception as e:
        return {"status": "error", "detail": str(e)}
    
@app.get("/views")
async def get_views(link: str = Query(..., description="Link to t.me/c/... message")):
    try:
        chat_id, message_id = parse_t_me_link(link)
        message = await client.get_messages(chat_id, ids=message_id)

        if not message:
            raise HTTPException(status_code=404, detail="Message not found")

        return {
            "channel_id": chat_id,
            "message_id": message_id,
            "views": message.views,
            "text": message.text[:100] if message.text else None
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/views_by_forward")
async def views_by_forward(
    link: str = Query(None, description="Ссылка на пересланное сообщение (t.me/c/... или t.me/username/...)"),
    forward_chat_id: int = Query(None, description="ID канала, из которого переслано сообщение"),
    forward_message_id: int = Query(None, description="ID пересланного сообщения")
):
    try:
        if link:
            chat, message_id = parse_t_me_link(link)
        elif forward_chat_id is not None and forward_message_id is not None:
            chat = forward_chat_id
            message_id = forward_message_id
        else:
            raise HTTPException(status_code=400, detail="Нужно передать либо link, либо forward_chat_id и forward_message_id")

        try:
            entity = await client.get_entity(chat)
        except Exception as e:
            raise HTTPException(status_code=404, detail=f"Не удалось получить entity: {e}")

        message = await client.get_messages(entity, ids=message_id)

        if not message:
            raise HTTPException(status_code=404, detail="Message not found")

        return {
            "channel": chat,
            "message_id": message_id,
            "views": message.views,
            "text": message.text[:100] if message.text else None
        }

    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка: {e}")
