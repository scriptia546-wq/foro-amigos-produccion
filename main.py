import os
import json
import uuid
import io
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any

import cloudinary
import cloudinary.uploader
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, DateTime, ForeignKey,
    UniqueConstraint, Boolean
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship, Session
from passlib.context import CryptContext

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./circulo.db")
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine_kwargs = {}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    display_name = Column(String(80), nullable=False)
    username = Column(String(40), unique=True, index=True, nullable=False)
    birth_date = Column(String(20), default="")
    password_hash = Column(String(255), nullable=False)
    bio = Column(Text, default="")
    avatar_url = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), default=now_utc)
    last_seen = Column(DateTime(timezone=True), default=now_utc)


class SessionToken(Base):
    __tablename__ = "session_tokens"
    id = Column(Integer, primary_key=True)
    token = Column(String(128), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)


class Post(Base):
    __tablename__ = "posts"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    channel = Column(String(40), default="general", index=True)
    type = Column(String(20), default="text")
    content = Column(Text, default="")
    media_url = Column(Text, default="")
    file_name = Column(Text, default="")
    file_size = Column(Integer, default=0)
    file_type = Column(String(120), default="")
    poll_json = Column(Text, default="")
    event_json = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), default=now_utc, index=True)
    user = relationship("User")


class Comment(Base):
    __tablename__ = "comments"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    user = relationship("User")


class Like(Base):
    __tablename__ = "likes"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_like"),)


class Save(Base):
    __tablename__ = "saves"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_post_save"),)


class PollVote(Base):
    __tablename__ = "poll_votes"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    option_index = Column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_poll_vote"),)


class FriendRequest(Base):
    __tablename__ = "friend_requests"
    id = Column(Integer, primary_key=True)
    from_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    to_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(20), default="pending")
    created_at = Column(DateTime(timezone=True), default=now_utc)


class Friendship(Base):
    __tablename__ = "friendships"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    friend_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    __table_args__ = (UniqueConstraint("user_id", "friend_id", name="uq_friendship"),)


class PrivateMessage(Base):
    __tablename__ = "private_messages"
    id = Column(Integer, primary_key=True)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(String(20), default="text")
    content = Column(Text, default="")
    media_url = Column(Text, default="")
    file_name = Column(Text, default="")
    file_size = Column(Integer, default=0)
    file_type = Column(String(120), default="")
    poll_json = Column(Text, default="")
    event_json = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), default=now_utc, index=True)
    sender = relationship("User", foreign_keys=[sender_id])
    recipient = relationship("User", foreign_keys=[recipient_id])


class PrivatePollVote(Base):
    __tablename__ = "private_poll_votes"
    id = Column(Integer, primary_key=True)
    message_id = Column(Integer, ForeignKey("private_messages.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    option_index = Column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("message_id", "user_id", name="uq_private_poll_vote"),)


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    type = Column(String(30), default="info")
    message = Column(Text, default="")
    post_id = Column(Integer, nullable=True)
    private_message_id = Column(Integer, nullable=True)
    friend_request_id = Column(Integer, nullable=True)
    channel = Column(String(40), default="")
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=now_utc, index=True)
    actor = relationship("User", foreign_keys=[actor_id])


Base.metadata.create_all(bind=engine)

app = FastAPI(title="Círculo / Foro Amigos API", version="4.0.0")

cors_origins = os.getenv("CORS_ORIGINS", "*")
origins = [o.strip() for o in cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)


def token_from_header(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="No has iniciado sesión.")
    if authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    return authorization.strip()


def get_current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> User:
    token = token_from_header(authorization)
    session = db.query(SessionToken).filter(SessionToken.token == token).first()
    if not session:
        raise HTTPException(status_code=401, detail="Sesión inválida o vencida.")
    user = db.query(User).filter(User.id == session.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no encontrado.")
    user.last_seen = now_utc()
    db.commit()
    db.refresh(user)
    return user


def is_online(user: User) -> bool:
    if not user.last_seen:
        return False
    last = user.last_seen
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    return now_utc() - last < timedelta(seconds=75)


def user_public(user: Optional[User], db: Optional[Session] = None) -> Optional[Dict[str, Any]]:
    if not user:
        return None
    count = 0
    if db:
        count = db.query(Post).filter(Post.user_id == user.id).count()
    return {
        "id": user.id,
        "display_name": user.display_name,
        "username": user.username,
        "bio": user.bio or "",
        "avatar_url": user.avatar_url or "",
        "publications": count,
        "online": is_online(user),
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def notification_public(n: Notification) -> Dict[str, Any]:
    return {
        "id": n.id,
        "type": n.type,
        "message": n.message,
        "post_id": n.post_id,
        "private_message_id": n.private_message_id,
        "friend_request_id": n.friend_request_id,
        "channel": n.channel,
        "is_read": n.is_read,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "actor": user_public(n.actor) if n.actor else None,
    }


def parse_json(text: str, fallback):
    if not text:
        return fallback
    try:
        return json.loads(text)
    except Exception:
        return fallback


def are_friends(db: Session, a: int, b: int) -> bool:
    return db.query(Friendship).filter(Friendship.user_id == a, Friendship.friend_id == b).first() is not None


def add_notification(db: Session, user_id: int, actor_id: Optional[int], typ: str, message: str,
                     post_id: Optional[int] = None, private_message_id: Optional[int] = None,
                     friend_request_id: Optional[int] = None, channel: str = ""):
    n = Notification(
        user_id=user_id,
        actor_id=actor_id,
        type=typ,
        message=message,
        post_id=post_id,
        private_message_id=private_message_id,
        friend_request_id=friend_request_id,
        channel=channel,
        is_read=False,
    )
    db.add(n)
    return n


def notify_mentions(db: Session, actor: User, text: str, post: Optional[Post] = None, private_message: Optional[PrivateMessage] = None):
    if not text:
        return
    words = set([w.strip(".,;:!?()[]{}<>\"'").lower() for w in text.split() if w.startswith("@")])
    for word in words:
        username = word[1:]
        if not username:
            continue
        user = db.query(User).filter(User.username == username).first()
        if user and user.id != actor.id:
            add_notification(
                db, user.id, actor.id, "mention",
                f"{actor.display_name} te mencionó.",
                post_id=post.id if post else None,
                private_message_id=private_message.id if private_message else None,
                channel=post.channel if post else ""
            )


def post_public(post: Post, db: Session, current_user_id: Optional[int] = None) -> Dict[str, Any]:
    likes_count = db.query(Like).filter(Like.post_id == post.id).count()
    comments_count = db.query(Comment).filter(Comment.post_id == post.id).count()
    saved = False
    liked = False
    if current_user_id:
        saved = db.query(Save).filter(Save.post_id == post.id, Save.user_id == current_user_id).first() is not None
        liked = db.query(Like).filter(Like.post_id == post.id, Like.user_id == current_user_id).first() is not None
    poll = parse_json(post.poll_json, None)
    event = parse_json(post.event_json, None)
    poll_votes = []
    my_vote = None
    if poll:
        options = poll.get("options", [])
        counts = [0 for _ in options]
        votes = db.query(PollVote).filter(PollVote.post_id == post.id).all()
        for v in votes:
            if 0 <= v.option_index < len(counts):
                counts[v.option_index] += 1
            if current_user_id and v.user_id == current_user_id:
                my_vote = v.option_index
        poll_votes = counts
    return {
        "id": post.id,
        "user": user_public(post.user, db),
        "channel": post.channel,
        "type": post.type,
        "content": post.content or "",
        "media_url": post.media_url or "",
        "file_name": post.file_name or "",
        "file_size": post.file_size or 0,
        "file_type": post.file_type or "",
        "poll": poll,
        "poll_votes": poll_votes,
        "my_vote": my_vote,
        "event": event,
        "created_at": post.created_at.isoformat() if post.created_at else None,
        "likes_count": likes_count,
        "comments_count": comments_count,
        "liked": liked,
        "saved": saved,
        "owner": current_user_id == post.user_id,
    }


def private_message_public(m: PrivateMessage, db: Session, current_user_id: int) -> Dict[str, Any]:
    poll = parse_json(m.poll_json, None)
    event = parse_json(m.event_json, None)
    counts = []
    my_vote = None
    if poll:
        options = poll.get("options", [])
        counts = [0 for _ in options]
        votes = db.query(PrivatePollVote).filter(PrivatePollVote.message_id == m.id).all()
        for v in votes:
            if 0 <= v.option_index < len(counts):
                counts[v.option_index] += 1
            if v.user_id == current_user_id:
                my_vote = v.option_index
    return {
        "id": m.id,
        "sender": user_public(m.sender),
        "recipient": user_public(m.recipient),
        "mine": m.sender_id == current_user_id,
        "type": m.type,
        "content": m.content or "",
        "media_url": m.media_url or "",
        "file_name": m.file_name or "",
        "file_size": m.file_size or 0,
        "file_type": m.file_type or "",
        "poll": poll,
        "poll_votes": counts,
        "my_vote": my_vote,
        "event": event,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


class RegisterIn(BaseModel):
    display_name: str
    username: str
    birth_date: str
    password: str


class LoginIn(BaseModel):
    username: str
    password: str


class ProfileIn(BaseModel):
    display_name: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None


class PostIn(BaseModel):
    channel: str = "general"
    type: str = "text"
    content: Optional[str] = ""
    media_url: Optional[str] = ""
    file_name: Optional[str] = ""
    file_size: Optional[int] = 0
    file_type: Optional[str] = ""
    poll: Optional[Dict[str, Any]] = None
    event: Optional[Dict[str, Any]] = None


class CommentIn(BaseModel):
    content: str


class VoteIn(BaseModel):
    option_index: int


class FriendRequestIn(BaseModel):
    to_user_id: int


class RespondRequestIn(BaseModel):
    action: str


class PrivateMessageIn(BaseModel):
    type: str = "text"
    content: Optional[str] = ""
    media_url: Optional[str] = ""
    file_name: Optional[str] = ""
    file_size: Optional[int] = 0
    file_type: Optional[str] = ""
    poll: Optional[Dict[str, Any]] = None
    event: Optional[Dict[str, Any]] = None


@app.get("/")
def root():
    return {"status": "ok", "message": "Círculo Privado V4 API funcionando.", "database": "postgres" if "postgres" in DATABASE_URL else "sqlite"}


@app.post("/api/auth/register")
def register(data: RegisterIn, db: Session = Depends(get_db)):
    username = data.username.strip().lower().replace(" ", "")
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="El nombre de usuario debe tener mínimo 3 caracteres.")
    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="La contraseña debe tener mínimo 4 caracteres.")
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Ese nombre de usuario ya existe.")
    user = User(
        display_name=data.display_name.strip() or username,
        username=username,
        birth_date=data.birth_date.strip(),
        password_hash=hash_password(data.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = uuid.uuid4().hex + uuid.uuid4().hex
    db.add(SessionToken(token=token, user_id=user.id))
    db.commit()
    return {"token": token, "user": user_public(user, db)}


@app.post("/api/auth/login")
def login(data: LoginIn, db: Session = Depends(get_db)):
    username = data.username.strip().lower()
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos.")
    user.last_seen = now_utc()
    token = uuid.uuid4().hex + uuid.uuid4().hex
    db.add(SessionToken(token=token, user_id=user.id))
    db.commit()
    db.refresh(user)
    return {"token": token, "user": user_public(user, db)}


@app.post("/api/auth/logout")
def logout(current: User = Depends(get_current_user), authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    token = token_from_header(authorization)
    db.query(SessionToken).filter(SessionToken.token == token).delete()
    current.last_seen = now_utc() - timedelta(minutes=5)
    db.commit()
    return {"ok": True}


@app.get("/api/me")
def me(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {"user": user_public(current, db)}


@app.put("/api/me")
def update_me(data: ProfileIn, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.display_name is not None and data.display_name.strip():
        current.display_name = data.display_name.strip()[:80]
    if data.bio is not None:
        current.bio = data.bio.strip()[:1000]
    if data.avatar_url is not None:
        current.avatar_url = data.avatar_url.strip()
    db.commit()
    db.refresh(current)
    return {"user": user_public(current, db)}


@app.post("/api/heartbeat")
def heartbeat(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current.last_seen = now_utc()
    db.commit()
    return {"ok": True, "online": True}


@app.get("/api/users/search")
def search_users(q: str = "", current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q_norm = q.strip().lower()
    if not q_norm:
        return {"users": []}
    users = db.query(User).filter(
        (User.username.ilike(f"%{q_norm}%")) | (User.display_name.ilike(f"%{q_norm}%"))
    ).limit(12).all()
    out = []
    for u in users:
        d = user_public(u, db)
        d["is_me"] = u.id == current.id
        d["are_friends"] = are_friends(db, current.id, u.id)
        pending = db.query(FriendRequest).filter(
            FriendRequest.status == "pending",
            ((FriendRequest.from_user_id == current.id) & (FriendRequest.to_user_id == u.id)) |
            ((FriendRequest.from_user_id == u.id) & (FriendRequest.to_user_id == current.id))
        ).first()
        d["pending_request"] = pending is not None
        out.append(d)
    return {"users": out}


@app.get("/api/users/{user_id}")
def get_user(user_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    d = user_public(u, db)
    d["is_me"] = u.id == current.id
    d["are_friends"] = are_friends(db, current.id, u.id)
    return {"user": d}


@app.get("/api/posts")
def get_posts(feed: str = "all", q: str = "", current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Post).order_by(Post.created_at.desc())
    if feed in ["general", "memes", "gaming", "coordinación-salidas"]:
        query = query.filter(Post.channel == feed)
    elif feed == "events":
        query = query.filter(Post.type == "event")
    elif feed == "saved":
        saved_ids = [s.post_id for s in db.query(Save).filter(Save.user_id == current.id).all()]
        if not saved_ids:
            return {"posts": []}
        query = query.filter(Post.id.in_(saved_ids))
    elif feed == "media":
        query = query.filter(Post.type.in_(["image", "file"]))
    elif feed == "downloads":
        query = query.filter(Post.type == "file")
    if q.strip():
        like = f"%{q.strip()}%"
        query = query.filter((Post.content.ilike(like)) | (Post.file_name.ilike(like)))
    posts = query.limit(80).all()
    return {"posts": [post_public(p, db, current.id) for p in posts]}


@app.post("/api/posts")
def create_post(data: PostIn, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    allowed_channels = {"general", "memes", "gaming", "coordinación-salidas"}
    channel = data.channel if data.channel in allowed_channels else "general"
    typ = data.type if data.type in {"text", "image", "file", "poll", "event", "share"} else "text"
    post = Post(
        user_id=current.id,
        channel=channel,
        type=typ,
        content=(data.content or "").strip(),
        media_url=data.media_url or "",
        file_name=data.file_name or "",
        file_size=int(data.file_size or 0),
        file_type=data.file_type or "",
        poll_json=json.dumps(data.poll) if data.poll else "",
        event_json=json.dumps(data.event) if data.event else "",
    )
    db.add(post)
    db.commit()
    db.refresh(post)

    # channel notifications for other users
    others = db.query(User).filter(User.id != current.id).all()
    for u in others:
        add_notification(db, u.id, current.id, "channel", f"Nuevo contenido en #{channel}.", post_id=post.id, channel=channel)
    notify_mentions(db, current, post.content or "", post=post)
    db.commit()
    db.refresh(post)
    return {"post": post_public(post, db, current.id)}


@app.delete("/api/posts/{post_id}")
def delete_post(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Publicación no encontrada.")
    if post.user_id != current.id:
        raise HTTPException(status_code=403, detail="No puedes eliminar publicaciones de otra persona.")
    db.query(Comment).filter(Comment.post_id == post_id).delete()
    db.query(Like).filter(Like.post_id == post_id).delete()
    db.query(Save).filter(Save.post_id == post_id).delete()
    db.query(PollVote).filter(PollVote.post_id == post_id).delete()
    db.query(Notification).filter(Notification.post_id == post_id).delete()
    db.delete(post)
    db.commit()
    return {"ok": True}


@app.post("/api/posts/{post_id}/like")
def toggle_like(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Publicación no encontrada.")
    like = db.query(Like).filter(Like.post_id == post_id, Like.user_id == current.id).first()
    if like:
        db.delete(like)
        liked = False
    else:
        db.add(Like(post_id=post_id, user_id=current.id))
        liked = True
        if post.user_id != current.id:
            add_notification(db, post.user_id, current.id, "like", f"{current.display_name} reaccionó a tu publicación.", post_id=post.id)
    db.commit()
    return {"liked": liked, "likes_count": db.query(Like).filter(Like.post_id == post_id).count()}


@app.post("/api/posts/{post_id}/save")
def toggle_save(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Publicación no encontrada.")
    save = db.query(Save).filter(Save.post_id == post_id, Save.user_id == current.id).first()
    if save:
        db.delete(save)
        saved = False
    else:
        db.add(Save(post_id=post_id, user_id=current.id))
        saved = True
    db.commit()
    return {"saved": saved}


@app.get("/api/posts/{post_id}/comments")
def get_comments(post_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    comments = db.query(Comment).filter(Comment.post_id == post_id).order_by(Comment.created_at.asc()).all()
    return {"comments": [{
        "id": c.id,
        "content": c.content,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "user": user_public(c.user)
    } for c in comments]}


@app.post("/api/posts/{post_id}/comments")
def add_comment(post_id: int, data: CommentIn, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Publicación no encontrada.")
    if not data.content.strip():
        raise HTTPException(status_code=400, detail="El comentario está vacío.")
    c = Comment(post_id=post_id, user_id=current.id, content=data.content.strip())
    db.add(c)
    db.commit()
    db.refresh(c)
    if post.user_id != current.id:
        add_notification(db, post.user_id, current.id, "comment", f"{current.display_name} comentó tu publicación.", post_id=post.id)
    notify_mentions(db, current, c.content, post=post)
    db.commit()
    return {"comment": {"id": c.id, "content": c.content, "created_at": c.created_at.isoformat(), "user": user_public(current)}}


@app.post("/api/posts/{post_id}/vote")
def vote_post(post_id: int, data: VoteIn, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post or post.type != "poll":
        raise HTTPException(status_code=404, detail="Encuesta no encontrada.")
    poll = parse_json(post.poll_json, {"options": []})
    if data.option_index < 0 or data.option_index >= len(poll.get("options", [])):
        raise HTTPException(status_code=400, detail="Opción inválida.")
    existing = db.query(PollVote).filter(PollVote.post_id == post_id, PollVote.user_id == current.id).first()
    if existing and existing.option_index == data.option_index:
        db.delete(existing)
    elif existing:
        existing.option_index = data.option_index
    else:
        db.add(PollVote(post_id=post_id, user_id=current.id, option_index=data.option_index))
    db.commit()
    return {"post": post_public(post, db, current.id)}


@app.put("/api/posts/{post_id}/event")
def update_event(post_id: int, data: PostIn, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post or post.type != "event":
        raise HTTPException(status_code=404, detail="Evento no encontrado.")
    if post.user_id != current.id:
        raise HTTPException(status_code=403, detail="No puedes editar eventos de otra persona.")
    post.content = (data.content or post.content or "").strip()
    post.event_json = json.dumps(data.event or {})
    db.commit()
    db.refresh(post)
    return {"post": post_public(post, db, current.id)}


@app.post("/api/upload")
async def upload_file(
    upload: UploadFile = File(...),
    folder: str = Form("circulo"),
    current: User = Depends(get_current_user)
):
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
    api_key = os.getenv("CLOUDINARY_API_KEY", "").strip()
    api_secret = os.getenv("CLOUDINARY_API_SECRET", "").strip()
    if not cloud_name or not api_key or not api_secret:
        raise HTTPException(status_code=500, detail="Faltan variables de Cloudinary en Render.")
    if cloud_name.lower() == "root":
        raise HTTPException(status_code=500, detail="CLOUDINARY_CLOUD_NAME está mal. Debe ser tu Cloud name real, por ejemplo dzouw2ol5, no Root.")
    cloudinary.config(cloud_name=cloud_name, api_key=api_key, api_secret=api_secret, secure=True)
    content = await upload.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="El archivo supera 25 MB.")
    try:
        file_obj = io.BytesIO(content)
        file_obj.name = upload.filename or "upload"
        result = cloudinary.uploader.upload(
            file_obj,
            folder=folder,
            resource_type="auto",
            filename_override=upload.filename,
            use_filename=True,
            unique_filename=True,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo subir a Cloudinary: {exc}")
    return {
        "url": result.get("secure_url"),
        "resource_type": result.get("resource_type"),
        "format": result.get("format"),
        "bytes": result.get("bytes", len(content)),
        "file_name": upload.filename,
        "file_type": upload.content_type or "",
    }


@app.post("/api/friends/request")
def send_friend_request(data: FriendRequestIn, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.to_user_id == current.id:
        raise HTTPException(status_code=400, detail="No puedes agregarte a ti mismo.")
    target = db.query(User).filter(User.id == data.to_user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado.")
    if are_friends(db, current.id, target.id):
        return {"ok": True, "message": "Ya son amigos."}
    existing = db.query(FriendRequest).filter(
        FriendRequest.status == "pending",
        ((FriendRequest.from_user_id == current.id) & (FriendRequest.to_user_id == target.id)) |
        ((FriendRequest.from_user_id == target.id) & (FriendRequest.to_user_id == current.id))
    ).first()
    if existing:
        return {"ok": True, "message": "Ya existe una solicitud pendiente."}
    fr = FriendRequest(from_user_id=current.id, to_user_id=target.id, status="pending")
    db.add(fr)
    db.commit()
    db.refresh(fr)
    add_notification(db, target.id, current.id, "friend_request", f"{current.display_name} quiere agregarte como amigo.", friend_request_id=fr.id)
    db.commit()
    return {"ok": True, "message": "Solicitud enviada."}


@app.post("/api/friends/request/{request_id}/respond")
def respond_friend_request(request_id: int, data: RespondRequestIn, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    fr = db.query(FriendRequest).filter(FriendRequest.id == request_id, FriendRequest.to_user_id == current.id).first()
    if not fr or fr.status != "pending":
        raise HTTPException(status_code=404, detail="Solicitud no encontrada.")
    action = data.action.lower().strip()
    if action == "accept":
        fr.status = "accepted"
        if not are_friends(db, fr.from_user_id, fr.to_user_id):
            db.add(Friendship(user_id=fr.from_user_id, friend_id=fr.to_user_id))
            db.add(Friendship(user_id=fr.to_user_id, friend_id=fr.from_user_id))
        sender = db.query(User).filter(User.id == fr.from_user_id).first()
        add_notification(db, fr.from_user_id, current.id, "friend_accepted", f"{current.display_name} aceptó tu solicitud.")
        msg = "Solicitud aceptada."
    elif action == "reject":
        fr.status = "rejected"
        msg = "Solicitud rechazada."
    else:
        raise HTTPException(status_code=400, detail="Acción inválida.")
    db.query(Notification).filter(Notification.friend_request_id == fr.id, Notification.user_id == current.id).delete()
    db.commit()
    return {"ok": True, "message": msg}


@app.get("/api/friends")
def list_friends(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    links = db.query(Friendship).filter(Friendship.user_id == current.id).all()
    users = []
    for link in links:
        u = db.query(User).filter(User.id == link.friend_id).first()
        if u:
            users.append(user_public(u, db))
    users.sort(key=lambda x: (not x["online"], x["display_name"].lower()))
    return {"friends": users}


@app.get("/api/notifications")
def get_notifications(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notifs = db.query(Notification).filter(Notification.user_id == current.id).order_by(Notification.created_at.desc()).limit(80).all()
    channel_counts: Dict[str, Dict[str, Any]] = {}
    for n in notifs:
        if n.is_read:
            continue
        if n.type in ["channel", "mention"] and n.channel:
            channel_counts.setdefault(n.channel, {"count": 0, "mention": False})
            channel_counts[n.channel]["count"] += 1
            if n.type == "mention":
                channel_counts[n.channel]["mention"] = True
    return {"notifications": [notification_public(n) for n in notifs if not n.is_read or n.type in ["friend_request", "private_message", "mention", "friend_accepted"]], "channel_counts": channel_counts}


@app.post("/api/notifications/{notification_id}/read")
def mark_notification(notification_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.user_id == current.id).first()
    if n:
        n.is_read = True
        db.commit()
    return {"ok": True}


@app.post("/api/notifications/mark_channel/{channel}")
def mark_channel(channel: str, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == current.id, Notification.channel == channel).update({"is_read": True})
    db.commit()
    return {"ok": True}


@app.post("/api/notifications/read_all")
def mark_all_notifications(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(Notification).filter(Notification.user_id == current.id, Notification.type != "friend_request").update({"is_read": True})
    db.commit()
    return {"ok": True}


@app.get("/api/private/{friend_id}")
def get_private_messages(friend_id: int, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not are_friends(db, current.id, friend_id):
        raise HTTPException(status_code=403, detail="Solo puedes chatear con amigos aceptados.")
    friend = db.query(User).filter(User.id == friend_id).first()
    if not friend:
        raise HTTPException(status_code=404, detail="Amigo no encontrado.")
    messages = db.query(PrivateMessage).filter(
        ((PrivateMessage.sender_id == current.id) & (PrivateMessage.recipient_id == friend_id)) |
        ((PrivateMessage.sender_id == friend_id) & (PrivateMessage.recipient_id == current.id))
    ).order_by(PrivateMessage.created_at.asc()).limit(300).all()
    db.query(Notification).filter(Notification.user_id == current.id, Notification.actor_id == friend_id, Notification.type == "private_message").update({"is_read": True})
    db.commit()
    return {"friend": user_public(friend, db), "messages": [private_message_public(m, db, current.id) for m in messages]}


@app.post("/api/private/{friend_id}")
def send_private_message(friend_id: int, data: PrivateMessageIn, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not are_friends(db, current.id, friend_id):
        raise HTTPException(status_code=403, detail="Solo puedes enviar mensajes a amigos aceptados.")
    friend = db.query(User).filter(User.id == friend_id).first()
    if not friend:
        raise HTTPException(status_code=404, detail="Amigo no encontrado.")
    typ = data.type if data.type in {"text", "image", "file", "poll", "event", "link"} else "text"
    m = PrivateMessage(
        sender_id=current.id,
        recipient_id=friend_id,
        type=typ,
        content=(data.content or "").strip(),
        media_url=data.media_url or "",
        file_name=data.file_name or "",
        file_size=int(data.file_size or 0),
        file_type=data.file_type or "",
        poll_json=json.dumps(data.poll) if data.poll else "",
        event_json=json.dumps(data.event) if data.event else "",
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    add_notification(db, friend_id, current.id, "private_message", f"Nuevo mensaje privado de {current.display_name}.", private_message_id=m.id)
    notify_mentions(db, current, m.content or "", private_message=m)
    db.commit()
    return {"message": private_message_public(m, db, current.id)}


@app.post("/api/private/message/{message_id}/vote")
def vote_private_poll(message_id: int, data: VoteIn, current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    m = db.query(PrivateMessage).filter(PrivateMessage.id == message_id).first()
    if not m or m.type != "poll":
        raise HTTPException(status_code=404, detail="Encuesta privada no encontrada.")
    if current.id not in [m.sender_id, m.recipient_id]:
        raise HTTPException(status_code=403, detail="No puedes votar en esta encuesta.")
    poll = parse_json(m.poll_json, {"options": []})
    if data.option_index < 0 or data.option_index >= len(poll.get("options", [])):
        raise HTTPException(status_code=400, detail="Opción inválida.")
    existing = db.query(PrivatePollVote).filter(PrivatePollVote.message_id == message_id, PrivatePollVote.user_id == current.id).first()
    if existing and existing.option_index == data.option_index:
        db.delete(existing)
    elif existing:
        existing.option_index = data.option_index
    else:
        db.add(PrivatePollVote(message_id=message_id, user_id=current.id, option_index=data.option_index))
    db.commit()
    return {"message": private_message_public(m, db, current.id)}
