"""
main.py
Backend production-ready para Círculo Privado.

Render:
    Build command:
        pip install -r requirements.txt

    Start command:
        uvicorn main:app --host 0.0.0.0 --port $PORT

Variables de entorno:
    DATABASE_URL
    CLOUDINARY_CLOUD_NAME
    CLOUDINARY_API_KEY
    CLOUDINARY_API_SECRET
"""

from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime
from typing import Generator, Optional

import cloudinary
import cloudinary.uploader
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, selectinload, sessionmaker


# =========================================================
# Configuración general
# =========================================================

load_dotenv()

raw_database_url = os.getenv("DATABASE_URL", "sqlite:///./private_forum.db")

# Render/Heroku a veces entregan postgres://.
# SQLAlchemy moderno espera postgresql:// o postgresql+psycopg2://.
if raw_database_url.startswith("postgres://"):
    raw_database_url = raw_database_url.replace("postgres://", "postgresql+psycopg2://", 1)

DATABASE_URL = raw_database_url

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)

cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True,
)

app = FastAPI(
    title="Círculo Privado API",
    description="API REST + WebSocket para un foro privado de amigos.",
    version="3.0.0",
)

# Abierto para Netlify + Render.
# Para máxima seguridad en producción real, cambia "*" por tu dominio exacto de Netlify.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# Base SQLAlchemy
# =========================================================

class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    token: Mapped[str] = mapped_column(String(96), unique=True, index=True, nullable=False)
    avatar_initials: Mapped[str] = mapped_column(String(4), nullable=False, default="U")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    posts: Mapped[list["Post"]] = relationship(back_populates="author", cascade="all, delete-orphan")
    likes: Mapped[list["PostLike"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    comments: Mapped[list["Comment"]] = relationship(back_populates="author", cascade="all, delete-orphan")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str] = mapped_column(String(40), index=True, nullable=False, default="general")
    image_url: Mapped[Optional[str]] = mapped_column(String(700), nullable=True)

    likes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    comments_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    author: Mapped[User] = relationship(back_populates="posts")
    liked_by: Mapped[list["PostLike"]] = relationship(back_populates="post", cascade="all, delete-orphan")
    comments: Mapped[list["Comment"]] = relationship(back_populates="post", cascade="all, delete-orphan")


class PostLike(Base):
    __tablename__ = "post_likes"
    __table_args__ = (
        UniqueConstraint("post_id", "user_id", name="unique_user_post_like"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    post: Mapped[Post] = relationship(back_populates="liked_by")
    user: Mapped[User] = relationship(back_populates="likes")


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id"), nullable=False)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)

    post: Mapped[Post] = relationship(back_populates="comments")
    author: Mapped[User] = relationship(back_populates="comments")


# =========================================================
# Esquemas Pydantic
# =========================================================

class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=4, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=80)


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: dict


class PostCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=1200)
    channel: str = Field(default="general", max_length=40)
    image_url: Optional[str] = Field(default=None, max_length=700)


class PostResponse(BaseModel):
    id: int
    content: str
    channel: str
    image_url: Optional[str]
    likes: int
    comments_count: int
    liked_by_me: bool
    created_at: str
    author: dict


class LikeResponse(BaseModel):
    post_id: int
    likes: int
    liked_by_me: bool


class CommentCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=800)


class CommentResponse(BaseModel):
    id: int
    content: str
    created_at: str
    post_id: int
    author: dict


class UploadResponse(BaseModel):
    url: str


# =========================================================
# Helpers
# =========================================================

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def create_token() -> str:
    return secrets.token_urlsafe(48)


def build_initials(name: str) -> str:
    parts = [part for part in name.strip().split() if part]
    if not parts:
        return "U"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return f"{parts[0][0]}{parts[1][0]}".upper()


def normalize_channel(channel: str) -> str:
    cleaned = channel.strip().lower().replace("#", "")
    allowed_channels = {"general", "memes", "coordinación-salidas", "coordinacion-salidas", "gaming"}

    if cleaned == "coordinacion-salidas":
        cleaned = "coordinación-salidas"

    if cleaned not in allowed_channels:
        return "general"

    return cleaned


def get_token_from_authorization(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Falta header Authorization: Bearer TOKEN",
        )

    scheme, _, token = authorization.partition(" ")

    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Formato inválido. Usa Authorization: Bearer TOKEN",
        )

    return token.strip()


def get_current_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    token = get_token_from_authorization(authorization)
    user = db.query(User).filter(User.token == token).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado.",
        )

    return user


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "avatar_initials": user.avatar_initials,
    }


def serialize_post(post: Post, current_user_id: Optional[int] = None) -> dict:
    liked_by_me = False

    if current_user_id is not None:
        liked_by_me = any(
            like.user_id == current_user_id and like.active
            for like in post.liked_by
        )

    return {
        "id": post.id,
        "content": post.content,
        "channel": post.channel,
        "image_url": post.image_url,
        "likes": post.likes,
        "comments_count": post.comments_count,
        "liked_by_me": liked_by_me,
        "created_at": post.created_at.isoformat(),
        "author": serialize_user(post.author),
    }


def serialize_comment(comment: Comment) -> dict:
    return {
        "id": comment.id,
        "content": comment.content,
        "created_at": comment.created_at.isoformat(),
        "post_id": comment.post_id,
        "author": serialize_user(comment.author),
    }


def ensure_cloudinary_configured() -> None:
    missing = [
        name
        for name in ("CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET")
        if not os.getenv(name)
    ]

    if missing:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Cloudinary no está configurado. Faltan variables: {', '.join(missing)}",
        )


# =========================================================
# WebSocket manager
# =========================================================

class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, payload: dict) -> None:
        disconnected: list[WebSocket] = []

        for connection in self.active_connections:
            try:
                await connection.send_json(payload)
            except Exception:
                disconnected.append(connection)

        for connection in disconnected:
            self.disconnect(connection)


manager = ConnectionManager()


# =========================================================
# Startup
# =========================================================

@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    run_lightweight_sqlite_migrations()
    seed_demo_data()


def run_lightweight_sqlite_migrations() -> None:
    """
    Migración mínima para SQLite local.
    En PostgreSQL producción se recomienda Alembic.
    """
    if not DATABASE_URL.startswith("sqlite"):
        return

    with engine.connect() as connection:
        columns = connection.exec_driver_sql("PRAGMA table_info(posts)").fetchall()
        column_names = {column[1] for column in columns}

        if "image_url" not in column_names:
            connection.exec_driver_sql("ALTER TABLE posts ADD COLUMN image_url VARCHAR(700)")
            connection.commit()


def seed_demo_data() -> None:
    db = SessionLocal()

    try:
        users_count = db.query(User).count()
        posts_count = db.query(Post).count()

        if users_count == 0:
            demo_users = [
                User(
                    username="rodrigo",
                    display_name="Rodrigo",
                    password_hash=hash_password("1234"),
                    token=create_token(),
                    avatar_initials="RA",
                ),
                User(
                    username="mateo",
                    display_name="Mateo",
                    password_hash=hash_password("1234"),
                    token=create_token(),
                    avatar_initials="MA",
                ),
                User(
                    username="valeria",
                    display_name="Valeria",
                    password_hash=hash_password("1234"),
                    token=create_token(),
                    avatar_initials="VA",
                ),
                User(
                    username="lucas",
                    display_name="Lucas",
                    password_hash=hash_password("1234"),
                    token=create_token(),
                    avatar_initials="LU",
                ),
            ]

            db.add_all(demo_users)
            db.commit()

        if posts_count == 0:
            mateo = db.query(User).filter(User.username == "mateo").first()
            valeria = db.query(User).filter(User.username == "valeria").first()
            lucas = db.query(User).filter(User.username == "lucas").first()

            demo_posts = [
                Post(
                    content="Gente, hoy podríamos organizar lo del fin de semana. Digan quiénes pueden y a qué hora les queda mejor.",
                    channel="general",
                    likes=8,
                    comments_count=0,
                    author_id=mateo.id,
                ),
                Post(
                    content="Subo este espacio como preview para el meme del día. Imaginen aquí una imagen o captura que solo el grupo puede ver.",
                    channel="memes",
                    likes=21,
                    comments_count=0,
                    author_id=valeria.id,
                ),
                Post(
                    content="Hoy en la noche sale partida privada. Llevo servidor listo y mods probados. Confirmen quién entra.",
                    channel="gaming",
                    likes=15,
                    comments_count=0,
                    author_id=lucas.id,
                ),
            ]

            db.add_all(demo_posts)
            db.commit()
    finally:
        db.close()


# =========================================================
# Auth
# =========================================================

@app.post("/register", response_model=AuthResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> AuthResponse:
    username = payload.username.strip().lower()
    display_name = (payload.display_name or payload.username).strip()

    existing_user = db.query(User).filter(User.username == username).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ese usuario ya existe.",
        )

    user = User(
        username=username,
        display_name=display_name,
        password_hash=hash_password(payload.password),
        token=create_token(),
        avatar_initials=build_initials(display_name),
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return AuthResponse(token=user.token, user=serialize_user(user))


@app.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    username = payload.username.strip().lower()
    password_hash = hash_password(payload.password)

    user = db.query(User).filter(User.username == username).first()

    if not user or user.password_hash != password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos.",
        )

    user.token = create_token()
    db.commit()
    db.refresh(user)

    return AuthResponse(token=user.token, user=serialize_user(user))


@app.get("/me")
def me(current_user: User = Depends(get_current_user)) -> dict:
    return serialize_user(current_user)


# =========================================================
# Posts
# =========================================================

@app.get("/posts", response_model=list[PostResponse])
def get_posts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    posts = (
        db.query(Post)
        .options(
            selectinload(Post.author),
            selectinload(Post.liked_by),
        )
        .order_by(Post.created_at.desc(), Post.id.desc())
        .all()
    )

    return [serialize_post(post, current_user.id) for post in posts]


@app.post("/posts", response_model=PostResponse, status_code=status.HTTP_201_CREATED)
async def create_post(
    payload: PostCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    post = Post(
        content=payload.content.strip(),
        channel=normalize_channel(payload.channel),
        image_url=payload.image_url,
        author_id=current_user.id,
    )

    db.add(post)
    db.commit()
    db.refresh(post)

    post = (
        db.query(Post)
        .options(
            selectinload(Post.author),
            selectinload(Post.liked_by),
        )
        .filter(Post.id == post.id)
        .first()
    )

    response = serialize_post(post, current_user.id)

    await manager.broadcast({
        "type": "new_post",
        "post": response,
    })

    return response


@app.delete("/posts/{post_id}")
async def delete_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    post = db.query(Post).filter(Post.id == post_id).first()

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post no encontrado.",
        )

    if post.author_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo el autor original puede eliminar esta publicación.",
        )

    db.delete(post)
    db.commit()

    await manager.broadcast({
        "type": "post_deleted",
        "post_id": post_id,
    })

    return {
        "ok": True,
        "message": "Post eliminado correctamente.",
        "post_id": post_id,
    }


@app.post("/posts/{post_id}/like", response_model=LikeResponse)
async def like_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    post = db.query(Post).filter(Post.id == post_id).first()

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post no encontrado.",
        )

    existing_like = (
        db.query(PostLike)
        .filter(PostLike.post_id == post_id, PostLike.user_id == current_user.id)
        .first()
    )

    if existing_like and existing_like.active:
        existing_like.active = False
        post.likes = max(0, post.likes - 1)
        liked_by_me = False
    elif existing_like and not existing_like.active:
        existing_like.active = True
        post.likes += 1
        liked_by_me = True
    else:
        like = PostLike(post_id=post.id, user_id=current_user.id, active=True)
        db.add(like)
        post.likes += 1
        liked_by_me = True

    db.commit()
    db.refresh(post)

    response = {
        "post_id": post.id,
        "likes": post.likes,
        "liked_by_me": liked_by_me,
    }

    await manager.broadcast({
        "type": "like_updated",
        "post_id": post.id,
        "likes": post.likes,
    })

    return response


# =========================================================
# Comentarios
# =========================================================

@app.get("/posts/{post_id}/comments", response_model=list[CommentResponse])
def get_comments(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    post = db.query(Post).filter(Post.id == post_id).first()

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post no encontrado.",
        )

    comments = (
        db.query(Comment)
        .options(selectinload(Comment.author))
        .filter(Comment.post_id == post_id)
        .order_by(Comment.created_at.asc(), Comment.id.asc())
        .all()
    )

    return [serialize_comment(comment) for comment in comments]


@app.post("/posts/{post_id}/comments", response_model=CommentResponse, status_code=status.HTTP_201_CREATED)
async def create_comment(
    post_id: int,
    payload: CommentCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    post = db.query(Post).filter(Post.id == post_id).first()

    if not post:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Post no encontrado.",
        )

    comment = Comment(
        content=payload.content.strip(),
        post_id=post.id,
        author_id=current_user.id,
    )

    post.comments_count += 1

    db.add(comment)
    db.commit()
    db.refresh(comment)

    comment = (
        db.query(Comment)
        .options(selectinload(Comment.author))
        .filter(Comment.id == comment.id)
        .first()
    )

    response = serialize_comment(comment)

    await manager.broadcast({
        "type": "new_comment",
        "post_id": post.id,
        "comment": response,
        "comments_count": post.comments_count,
    })

    return response


# =========================================================
# Cloudinary Upload
# =========================================================

ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(5 * 1024 * 1024)))


@app.post("/upload", response_model=UploadResponse)
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> dict:
    ensure_cloudinary_configured()

    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Formato no permitido. Usa JPG, PNG, WEBP o GIF.",
        )

    content = await file.read()
    await file.close()

    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="La imagen es demasiado pesada.",
        )

    try:
        result = cloudinary.uploader.upload(
            content,
            folder="foro_privado/uploads",
            resource_type="image",
            overwrite=False,
            use_filename=False,
            unique_filename=True,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"No se pudo subir la imagen a Cloudinary: {exc}",
        ) from exc

    secure_url = result.get("secure_url")

    if not secure_url:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Cloudinary no devolvió una URL segura.",
        )

    return {"url": secure_url}


# =========================================================
# WebSocket
# =========================================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str) -> None:
    db = SessionLocal()

    try:
        user = db.query(User).filter(User.token == token).first()

        if not user:
            await websocket.close(code=1008)
            return

        await manager.connect(websocket)

        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(websocket)
    finally:
        db.close()


# =========================================================
# Health check
# =========================================================

@app.get("/")
def health_check() -> dict:
    return {
        "status": "ok",
        "message": "Círculo Privado API funcionando.",
        "docs": "/docs",
        "database": "postgresql" if DATABASE_URL.startswith("postgresql") else "sqlite",
    }
