
from __future__ import annotations
import hashlib, os, secrets
from datetime import datetime
from typing import Generator, Optional
import cloudinary, cloudinary.uploader
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, or_, and_
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, selectinload, sessionmaker

load_dotenv()
raw_database_url = os.getenv("DATABASE_URL", "sqlite:///./private_forum.db")
if raw_database_url.startswith("postgres://"):
    raw_database_url = raw_database_url.replace("postgres://", "postgresql+psycopg2://", 1)
DATABASE_URL = raw_database_url
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
cloudinary.config(cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"), api_key=os.getenv("CLOUDINARY_API_KEY"), api_secret=os.getenv("CLOUDINARY_API_SECRET"), secure=True)
app = FastAPI(title="Círculo Privado V2 API", version="4.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"])

class Base(DeclarativeBase): pass

class User(Base):
    __tablename__="users"
    id:Mapped[int]=mapped_column(Integer,primary_key=True,index=True)
    username:Mapped[str]=mapped_column(String(40),unique=True,index=True,nullable=False)
    display_name:Mapped[str]=mapped_column(String(80),nullable=False)
    password_hash:Mapped[str]=mapped_column(String(128),nullable=False)
    token:Mapped[str]=mapped_column(String(96),unique=True,index=True,nullable=False)
    avatar_initials:Mapped[str]=mapped_column(String(4),nullable=False,default="U")
    avatar_url:Mapped[Optional[str]]=mapped_column(String(700),nullable=True)
    bio:Mapped[Optional[str]]=mapped_column(String(240),nullable=True)
    last_seen:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)

class Post(Base):
    __tablename__="posts"
    id:Mapped[int]=mapped_column(Integer,primary_key=True,index=True)
    content:Mapped[str]=mapped_column(Text,nullable=False)
    channel:Mapped[str]=mapped_column(String(40),index=True,nullable=False,default="general")
    post_type:Mapped[str]=mapped_column(String(20),nullable=False,default="text")
    image_url:Mapped[Optional[str]]=mapped_column(String(700),nullable=True)
    likes:Mapped[int]=mapped_column(Integer,nullable=False,default=0)
    comments_count:Mapped[int]=mapped_column(Integer,nullable=False,default=0)
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow,index=True)
    author_id:Mapped[int]=mapped_column(ForeignKey("users.id"),nullable=False)
    author:Mapped[User]=relationship()
    liked_by:Mapped[list["PostLike"]]=relationship(cascade="all, delete-orphan")
    poll:Mapped[Optional["Poll"]]=relationship(back_populates="post",cascade="all, delete-orphan",uselist=False)
    event:Mapped[Optional["Event"]]=relationship(back_populates="post",cascade="all, delete-orphan",uselist=False)

class PostLike(Base):
    __tablename__="post_likes"; __table_args__=(UniqueConstraint("post_id","user_id",name="unique_user_post_like"),)
    id:Mapped[int]=mapped_column(Integer,primary_key=True)
    post_id:Mapped[int]=mapped_column(ForeignKey("posts.id"),nullable=False)
    user_id:Mapped[int]=mapped_column(ForeignKey("users.id"),nullable=False)
    active:Mapped[bool]=mapped_column(Boolean,nullable=False,default=True)
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)

class Comment(Base):
    __tablename__="comments"
    id:Mapped[int]=mapped_column(Integer,primary_key=True,index=True)
    content:Mapped[str]=mapped_column(Text,nullable=False)
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow,index=True)
    post_id:Mapped[int]=mapped_column(ForeignKey("posts.id"),nullable=False)
    author_id:Mapped[int]=mapped_column(ForeignKey("users.id"),nullable=False)
    author:Mapped[User]=relationship()

class Poll(Base):
    __tablename__="polls"
    id:Mapped[int]=mapped_column(Integer,primary_key=True)
    question:Mapped[str]=mapped_column(String(220),nullable=False)
    multiple:Mapped[bool]=mapped_column(Boolean,default=False)
    post_id:Mapped[int]=mapped_column(ForeignKey("posts.id"),nullable=False)
    post:Mapped[Post]=relationship(back_populates="poll")
    options:Mapped[list["PollOption"]]=relationship(back_populates="poll",cascade="all, delete-orphan")

class PollOption(Base):
    __tablename__="poll_options"
    id:Mapped[int]=mapped_column(Integer,primary_key=True)
    text:Mapped[str]=mapped_column(String(160),nullable=False)
    votes:Mapped[int]=mapped_column(Integer,default=0)
    poll_id:Mapped[int]=mapped_column(ForeignKey("polls.id"),nullable=False)
    poll:Mapped[Poll]=relationship(back_populates="options")

class PollVote(Base):
    __tablename__="poll_votes"; __table_args__=(UniqueConstraint("poll_id","option_id","user_id",name="unique_vote_per_option"),)
    id:Mapped[int]=mapped_column(Integer,primary_key=True)
    poll_id:Mapped[int]=mapped_column(ForeignKey("polls.id"),nullable=False)
    option_id:Mapped[int]=mapped_column(ForeignKey("poll_options.id"),nullable=False)
    user_id:Mapped[int]=mapped_column(ForeignKey("users.id"),nullable=False)
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)

class Event(Base):
    __tablename__="events"
    id:Mapped[int]=mapped_column(Integer,primary_key=True)
    title:Mapped[str]=mapped_column(String(180),nullable=False)
    description:Mapped[Optional[str]]=mapped_column(Text,nullable=True)
    start_at:Mapped[Optional[datetime]]=mapped_column(DateTime,nullable=True)
    location:Mapped[Optional[str]]=mapped_column(String(180),nullable=True)
    post_id:Mapped[int]=mapped_column(ForeignKey("posts.id"),nullable=False)
    post:Mapped[Post]=relationship(back_populates="event")

class Friendship(Base):
    __tablename__="friendships"; __table_args__=(UniqueConstraint("requester_id","receiver_id",name="unique_friend_request"),)
    id:Mapped[int]=mapped_column(Integer,primary_key=True)
    requester_id:Mapped[int]=mapped_column(ForeignKey("users.id"),nullable=False)
    receiver_id:Mapped[int]=mapped_column(ForeignKey("users.id"),nullable=False)
    status:Mapped[str]=mapped_column(String(20),default="pending")
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)
    updated_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)

class Notification(Base):
    __tablename__="notifications"
    id:Mapped[int]=mapped_column(Integer,primary_key=True)
    user_id:Mapped[int]=mapped_column(ForeignKey("users.id"),nullable=False)
    actor_id:Mapped[Optional[int]]=mapped_column(ForeignKey("users.id"),nullable=True)
    type:Mapped[str]=mapped_column(String(40),nullable=False)
    message:Mapped[str]=mapped_column(String(260),nullable=False)
    entity_id:Mapped[Optional[int]]=mapped_column(Integer,nullable=True)
    read:Mapped[bool]=mapped_column(Boolean,default=False)
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)

class DirectMessage(Base):
    __tablename__="direct_messages"
    id:Mapped[int]=mapped_column(Integer,primary_key=True)
    sender_id:Mapped[int]=mapped_column(ForeignKey("users.id"),nullable=False)
    receiver_id:Mapped[int]=mapped_column(ForeignKey("users.id"),nullable=False)
    content:Mapped[str]=mapped_column(Text,nullable=False)
    read:Mapped[bool]=mapped_column(Boolean,default=False)
    created_at:Mapped[datetime]=mapped_column(DateTime,default=datetime.utcnow)

class RegisterRequest(BaseModel):
    username:str=Field(min_length=3,max_length=40); password:str=Field(min_length=4,max_length=128); display_name:Optional[str]=Field(default=None,max_length=80)
class LoginRequest(BaseModel): username:str; password:str
class ProfileUpdateRequest(BaseModel): display_name:Optional[str]=None; bio:Optional[str]=None; avatar_url:Optional[str]=None
class PostCreateRequest(BaseModel): content:str=Field(min_length=1,max_length=1200); channel:str="general"; image_url:Optional[str]=None; post_type:str="text"
class CommentCreateRequest(BaseModel): content:str=Field(min_length=1,max_length=800)
class PollCreateRequest(BaseModel): question:str=Field(min_length=1,max_length=220); options:list[str]=Field(min_length=2,max_length=8); multiple:bool=False; channel:str="general"
class PollVoteRequest(BaseModel): option_ids:list[int]=Field(min_length=1,max_length=8)
class EventCreateRequest(BaseModel): title:str=Field(min_length=1,max_length=180); description:Optional[str]=None; start_at:Optional[str]=None; location:Optional[str]=None; channel:str="general"
class EventUpdateRequest(BaseModel): title:Optional[str]=None; description:Optional[str]=None; start_at:Optional[str]=None; location:Optional[str]=None
class DirectMessageCreate(BaseModel): content:str=Field(min_length=1,max_length=1000)

def get_db()->Generator[Session,None,None]:
    db=SessionLocal()
    try: yield db
    finally: db.close()
def hash_password(p:str)->str: return hashlib.sha256(p.encode()).hexdigest()
def create_token()->str: return secrets.token_urlsafe(48)
def build_initials(name:str)->str:
    parts=[p for p in name.strip().split() if p]
    return "U" if not parts else (parts[0][:2].upper() if len(parts)==1 else f"{parts[0][0]}{parts[1][0]}".upper())
def normalize_channel(channel:str)->str:
    c=(channel or "general").strip().lower().replace("#","")
    if c=="coordinacion-salidas": c="coordinación-salidas"
    return c if c in {"general","memes","coordinación-salidas","gaming"} else "general"
def parse_datetime(v:Optional[str])->Optional[datetime]:
    if not v: return None
    try: return datetime.fromisoformat(v)
    except ValueError: raise HTTPException(status_code=400,detail="Fecha inválida.")
def get_current_user(authorization:Optional[str]=Header(default=None),db:Session=Depends(get_db))->User:
    if not authorization: raise HTTPException(status_code=401,detail="Falta Authorization.")
    scheme,_,token=authorization.partition(" ")
    if scheme.lower()!="bearer" or not token: raise HTTPException(status_code=401,detail="Formato inválido.")
    user=db.query(User).filter(User.token==token.strip()).first()
    if not user: raise HTTPException(status_code=401,detail="Token inválido.")
    user.last_seen=datetime.utcnow(); db.commit()
    return user

class ConnectionManager:
    def __init__(self): self.active:dict[int,list[WebSocket]]={}
    async def connect(self,user_id:int,ws:WebSocket):
        await ws.accept(); self.active.setdefault(user_id,[]).append(ws); await self.broadcast({"type":"presence_updated","user_id":user_id,"online":True})
    def disconnect(self,user_id:int,ws:WebSocket):
        conns=self.active.get(user_id,[])
        if ws in conns: conns.remove(ws)
        if not conns: self.active.pop(user_id,None)
    async def send_to_user(self,user_id:int,payload:dict):
        dead=[]
        for ws in self.active.get(user_id,[]):
            try: await ws.send_json(payload)
            except Exception: dead.append(ws)
        for ws in dead: self.disconnect(user_id,ws)
    async def broadcast(self,payload:dict):
        for uid in list(self.active.keys()): await self.send_to_user(uid,payload)
manager=ConnectionManager()
def is_online(user_id:int)->bool: return user_id in manager.active

def serialize_user(user:User,current_user_id:Optional[int]=None,db:Optional[Session]=None)->dict:
    status=None; fid=None
    if current_user_id and db and user.id!=current_user_id:
        fr=db.query(Friendship).filter(or_(and_(Friendship.requester_id==current_user_id,Friendship.receiver_id==user.id),and_(Friendship.requester_id==user.id,Friendship.receiver_id==current_user_id))).first()
        if fr: status=fr.status; fid=fr.id
    return {"id":user.id,"username":user.username,"display_name":user.display_name,"avatar_initials":user.avatar_initials,"avatar_url":user.avatar_url,"bio":user.bio,"online":is_online(user.id),"friendship_status":status,"friendship_id":fid}
def serialize_poll(poll,current_user_id,db):
    if not poll: return None
    selected=[v.option_id for v in db.query(PollVote).filter(PollVote.poll_id==poll.id,PollVote.user_id==current_user_id).all()] if current_user_id else []
    total=sum(o.votes for o in poll.options)
    return {"id":poll.id,"question":poll.question,"multiple":poll.multiple,"total_votes":total,"selected_option_ids":selected,"options":[{"id":o.id,"text":o.text,"votes":o.votes} for o in poll.options]}
def serialize_event(event):
    if not event: return None
    return {"id":event.id,"title":event.title,"description":event.description,"start_at":event.start_at.isoformat() if event.start_at else None,"location":event.location}
def serialize_post(post:Post,current_user_id:int,db:Session)->dict:
    liked=any(l.user_id==current_user_id and l.active for l in post.liked_by)
    return {"id":post.id,"content":post.content,"channel":post.channel,"post_type":post.post_type,"image_url":post.image_url,"likes":post.likes,"comments_count":post.comments_count,"liked_by_me":liked,"created_at":post.created_at.isoformat(),"author":serialize_user(post.author,current_user_id,db),"poll":serialize_poll(post.poll,current_user_id,db),"event":serialize_event(post.event)}
def serialize_comment(c:Comment)->dict: return {"id":c.id,"content":c.content,"created_at":c.created_at.isoformat(),"post_id":c.post_id,"author":serialize_user(c.author)}
def serialize_notification(n:Notification,db:Session)->dict:
    actor=db.query(User).filter(User.id==n.actor_id).first() if n.actor_id else None
    return {"id":n.id,"type":n.type,"message":n.message,"entity_id":n.entity_id,"read":n.read,"created_at":n.created_at.isoformat(),"actor":serialize_user(actor) if actor else None}
def serialize_dm(dm:DirectMessage,current_user_id:int,db:Session)->dict:
    s=db.query(User).filter(User.id==dm.sender_id).first(); r=db.query(User).filter(User.id==dm.receiver_id).first()
    return {"id":dm.id,"content":dm.content,"created_at":dm.created_at.isoformat(),"sender":serialize_user(s),"receiver":serialize_user(r),"mine":dm.sender_id==current_user_id}
def users_are_friends(db,a,b)->bool:
    return db.query(Friendship).filter(Friendship.status=="accepted",or_(and_(Friendship.requester_id==a,Friendship.receiver_id==b),and_(Friendship.requester_id==b,Friendship.receiver_id==a))).first() is not None
async def notify_user(db,user_id,actor_id,type_,message,entity_id=None):
    n=Notification(user_id=user_id,actor_id=actor_id,type=type_,message=message,entity_id=entity_id); db.add(n); db.commit(); db.refresh(n)
    await manager.send_to_user(user_id,{"type":"notification","notification":serialize_notification(n,db)})

@app.on_event("startup")
def startup():
    Base.metadata.create_all(bind=engine)
    db=SessionLocal()
    try:
        if db.query(User).count()==0:
            for u,d in [("rodrigo","Rodrigo"),("mateo","Mateo"),("valeria","Valeria"),("lucas","Lucas")]:
                db.add(User(username=u,display_name=d,password_hash=hash_password("1234"),token=create_token(),avatar_initials=build_initials(d)))
            db.commit()
    finally: db.close()

@app.post("/register")
def register(p:RegisterRequest,db:Session=Depends(get_db)):
    username=p.username.strip().lower(); display=(p.display_name or p.username).strip()
    if db.query(User).filter(User.username==username).first(): raise HTTPException(status_code=409,detail="Ese usuario ya existe.")
    user=User(username=username,display_name=display,password_hash=hash_password(p.password),token=create_token(),avatar_initials=build_initials(display))
    db.add(user); db.commit(); db.refresh(user); return {"token":user.token,"user":serialize_user(user)}
@app.post("/login")
def login(p:LoginRequest,db:Session=Depends(get_db)):
    user=db.query(User).filter(User.username==p.username.strip().lower()).first()
    if not user or user.password_hash!=hash_password(p.password): raise HTTPException(status_code=401,detail="Usuario o contraseña incorrectos.")
    user.token=create_token(); user.last_seen=datetime.utcnow(); db.commit(); db.refresh(user); return {"token":user.token,"user":serialize_user(user)}
@app.get("/me")
def me(user:User=Depends(get_current_user),db:Session=Depends(get_db)): return serialize_user(user,user.id,db)
@app.patch("/me")
def update_me(p:ProfileUpdateRequest,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    if p.display_name is not None and p.display_name.strip(): user.display_name=p.display_name.strip(); user.avatar_initials=build_initials(user.display_name)
    if p.bio is not None: user.bio=p.bio.strip()
    if p.avatar_url is not None: user.avatar_url=p.avatar_url.strip() or None
    db.commit(); db.refresh(user); return serialize_user(user,user.id,db)

@app.post("/upload")
async def upload(file:UploadFile=File(...),user:User=Depends(get_current_user)):
    if file.content_type not in {"image/jpeg","image/png","image/webp","image/gif"}: raise HTTPException(status_code=415,detail="Formato no permitido.")
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"); api_key=os.getenv("CLOUDINARY_API_KEY"); api_secret=os.getenv("CLOUDINARY_API_SECRET")
    if not cloud_name or not api_key or not api_secret: raise HTTPException(status_code=500,detail="Cloudinary no está configurado en Render.")
    if cloud_name.strip().lower() in {"root","cloudinary","api keys"}: raise HTTPException(status_code=500,detail="CLOUDINARY_CLOUD_NAME está mal. No debe ser Root.")
    content=await file.read(); await file.close()
    if len(content)>int(os.getenv("MAX_UPLOAD_BYTES",str(5*1024*1024))): raise HTTPException(status_code=413,detail="La imagen es demasiado pesada.")
    try: result=cloudinary.uploader.upload(content,folder=f"foro_privado/user_{user.id}",resource_type="image",overwrite=False,use_filename=False,unique_filename=True)
    except Exception as exc: raise HTTPException(status_code=502,detail=f"No se pudo subir la imagen a Cloudinary: {exc}") from exc
    return {"url":result.get("secure_url")}

@app.get("/users/search")
def search_users(q:str,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    q=(q or "").strip().lower()
    if len(q)<2: return []
    users=db.query(User).filter(User.id!=user.id,or_(User.username.ilike(f"%{q}%"),User.display_name.ilike(f"%{q}%"))).limit(12).all()
    return [serialize_user(u,user.id,db) for u in users]
@app.get("/users/{user_id}")
def get_user(user_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    target=db.query(User).filter(User.id==user_id).first()
    if not target: raise HTTPException(status_code=404,detail="Usuario no encontrado.")
    return {**serialize_user(target,user.id,db),"posts_count":db.query(Post).filter(Post.author_id==target.id).count()}
@app.post("/friends/request/{receiver_id}")
async def friend_request(receiver_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    if receiver_id==user.id: raise HTTPException(status_code=400,detail="No puedes agregarte a ti mismo.")
    receiver=db.query(User).filter(User.id==receiver_id).first()
    if not receiver: raise HTTPException(status_code=404,detail="Usuario no encontrado.")
    fr=db.query(Friendship).filter(or_(and_(Friendship.requester_id==user.id,Friendship.receiver_id==receiver_id),and_(Friendship.requester_id==receiver_id,Friendship.receiver_id==user.id))).first()
    if not fr: fr=Friendship(requester_id=user.id,receiver_id=receiver_id,status="pending"); db.add(fr)
    else:
        if fr.status=="rejected": fr.status="pending"; fr.requester_id=user.id; fr.receiver_id=receiver_id
    db.commit(); db.refresh(fr); await notify_user(db,receiver_id,user.id,"friend_request",f"{user.display_name} quiere agregarte como amigo.",fr.id)
    return {"ok":True,"friendship":{"id":fr.id,"status":fr.status}}
@app.post("/friends/respond/{friendship_id}")
async def respond_friend(friendship_id:int,action:str,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    fr=db.query(Friendship).filter(Friendship.id==friendship_id).first()
    if not fr: raise HTTPException(status_code=404,detail="Solicitud no encontrada.")
    if fr.receiver_id!=user.id: raise HTTPException(status_code=403,detail="Solo quien recibe responde.")
    if action not in {"accept","reject"}: raise HTTPException(status_code=400,detail="Acción inválida.")
    fr.status="accepted" if action=="accept" else "rejected"; fr.updated_at=datetime.utcnow(); db.commit()
    await notify_user(db,fr.requester_id,user.id,"friend_response",f"{user.display_name} {'aceptó' if action=='accept' else 'rechazó'} tu solicitud.",fr.id)
    await manager.broadcast({"type":"friends_updated"}); return {"ok":True}
@app.get("/friends")
def friends(user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    rels=db.query(Friendship).filter(Friendship.status=="accepted",or_(Friendship.requester_id==user.id,Friendship.receiver_id==user.id)).all()
    friends=[]
    for r in rels:
        fid=r.receiver_id if r.requester_id==user.id else r.requester_id
        u=db.query(User).filter(User.id==fid).first()
        if u: friends.append(serialize_user(u,user.id,db))
    return {"online":[f for f in friends if f["online"]],"offline":[f for f in friends if not f["online"]]}

@app.get("/notifications")
def notifications(user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    return [serialize_notification(n,db) for n in db.query(Notification).filter(Notification.user_id==user.id).order_by(Notification.created_at.desc()).limit(40).all()]

@app.get("/posts")
def posts(user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    ps=db.query(Post).options(selectinload(Post.author),selectinload(Post.liked_by),selectinload(Post.poll).selectinload(Poll.options),selectinload(Post.event)).order_by(Post.created_at.desc(),Post.id.desc()).all()
    return [serialize_post(p,user.id,db) for p in ps]
@app.post("/posts")
async def create_post(p:PostCreateRequest,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    post=Post(content=p.content.strip(),channel=normalize_channel(p.channel),image_url=p.image_url,post_type=p.post_type or "text",author_id=user.id)
    db.add(post); db.commit(); db.refresh(post)
    post=db.query(Post).options(selectinload(Post.author),selectinload(Post.liked_by)).filter(Post.id==post.id).first()
    res=serialize_post(post,user.id,db); await manager.broadcast({"type":"new_post","post":res}); return res
@app.delete("/posts/{post_id}")
async def delete_post(post_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    post=db.query(Post).filter(Post.id==post_id).first()
    if not post: raise HTTPException(status_code=404,detail="Post no encontrado.")
    if post.author_id!=user.id: raise HTTPException(status_code=403,detail="Solo el autor puede eliminar.")
    db.delete(post); db.commit(); await manager.broadcast({"type":"post_deleted","post_id":post_id}); return {"ok":True}
@app.post("/posts/{post_id}/like")
async def like(post_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    post=db.query(Post).filter(Post.id==post_id).first()
    if not post: raise HTTPException(status_code=404,detail="Post no encontrado.")
    like=db.query(PostLike).filter(PostLike.post_id==post_id,PostLike.user_id==user.id).first()
    if like and like.active: like.active=False; post.likes=max(0,post.likes-1); liked=False
    elif like: like.active=True; post.likes+=1; liked=True
    else: db.add(PostLike(post_id=post_id,user_id=user.id,active=True)); post.likes+=1; liked=True
    db.commit(); await manager.broadcast({"type":"like_updated","post_id":post.id,"likes":post.likes}); return {"post_id":post.id,"likes":post.likes,"liked_by_me":liked}
@app.get("/posts/{post_id}/comments")
def comments(post_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    return [serialize_comment(c) for c in db.query(Comment).options(selectinload(Comment.author)).filter(Comment.post_id==post_id).order_by(Comment.created_at.asc()).all()]
@app.post("/posts/{post_id}/comments")
async def add_comment(post_id:int,p:CommentCreateRequest,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    post=db.query(Post).filter(Post.id==post_id).first()
    if not post: raise HTTPException(status_code=404,detail="Post no encontrado.")
    c=Comment(content=p.content.strip(),post_id=post.id,author_id=user.id); post.comments_count+=1; db.add(c); db.commit(); db.refresh(c)
    c=db.query(Comment).options(selectinload(Comment.author)).filter(Comment.id==c.id).first(); res=serialize_comment(c)
    await manager.broadcast({"type":"new_comment","post_id":post.id,"comment":res,"comments_count":post.comments_count}); return res

@app.post("/polls")
async def create_poll(p:PollCreateRequest,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    opts=[o.strip() for o in p.options if o.strip()]
    if len(opts)<2: raise HTTPException(status_code=400,detail="Mínimo 2 opciones.")
    post=Post(content=p.question.strip(),channel=normalize_channel(p.channel),post_type="poll",author_id=user.id); db.add(post); db.commit(); db.refresh(post)
    poll=Poll(question=p.question.strip(),multiple=p.multiple,post_id=post.id); db.add(poll); db.commit(); db.refresh(poll)
    for t in opts[:8]: db.add(PollOption(text=t,poll_id=poll.id))
    db.commit()
    post=db.query(Post).options(selectinload(Post.author),selectinload(Post.liked_by),selectinload(Post.poll).selectinload(Poll.options)).filter(Post.id==post.id).first()
    res=serialize_post(post,user.id,db); await manager.broadcast({"type":"new_post","post":res}); return res
@app.post("/polls/{poll_id}/vote")
async def vote(poll_id:int,p:PollVoteRequest,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    poll=db.query(Poll).options(selectinload(Poll.options)).filter(Poll.id==poll_id).first()
    if not poll: raise HTTPException(status_code=404,detail="Encuesta no encontrada.")
    ids=set(p.option_ids); valid={o.id for o in poll.options}
    if not ids.issubset(valid): raise HTTPException(status_code=400,detail="Opción inválida.")
    if not poll.multiple and len(ids)>1: raise HTTPException(status_code=400,detail="Solo una opción.")
    for old in db.query(PollVote).filter(PollVote.poll_id==poll.id,PollVote.user_id==user.id).all():
        opt=db.query(PollOption).filter(PollOption.id==old.option_id).first()
        if opt: opt.votes=max(0,opt.votes-1)
        db.delete(old)
    for oid in ids:
        opt=db.query(PollOption).filter(PollOption.id==oid).first(); opt.votes+=1; db.add(PollVote(poll_id=poll.id,option_id=oid,user_id=user.id))
    db.commit()
    post=db.query(Post).options(selectinload(Post.author),selectinload(Post.liked_by),selectinload(Post.poll).selectinload(Poll.options),selectinload(Post.event)).filter(Post.id==poll.post_id).first()
    res=serialize_post(post,user.id,db); await manager.broadcast({"type":"poll_updated","post":res}); return res

@app.post("/events")
async def create_event(p:EventCreateRequest,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    post=Post(content=p.title.strip(),channel=normalize_channel(p.channel),post_type="event",author_id=user.id); db.add(post); db.commit(); db.refresh(post)
    ev=Event(title=p.title.strip(),description=(p.description or "").strip() or None,start_at=parse_datetime(p.start_at),location=(p.location or "").strip() or None,post_id=post.id); db.add(ev); db.commit()
    post=db.query(Post).options(selectinload(Post.author),selectinload(Post.liked_by),selectinload(Post.event)).filter(Post.id==post.id).first()
    res=serialize_post(post,user.id,db); await manager.broadcast({"type":"new_post","post":res}); return res
@app.patch("/events/{event_id}")
async def update_event(event_id:int,p:EventUpdateRequest,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    ev=db.query(Event).filter(Event.id==event_id).first()
    if not ev: raise HTTPException(status_code=404,detail="Evento no encontrado.")
    post=db.query(Post).filter(Post.id==ev.post_id).first()
    if post.author_id!=user.id: raise HTTPException(status_code=403,detail="Solo el autor modifica.")
    if p.title is not None and p.title.strip(): ev.title=p.title.strip(); post.content=ev.title
    if p.description is not None: ev.description=p.description.strip() or None
    if p.start_at is not None: ev.start_at=parse_datetime(p.start_at)
    if p.location is not None: ev.location=p.location.strip() or None
    db.commit()
    post=db.query(Post).options(selectinload(Post.author),selectinload(Post.liked_by),selectinload(Post.event)).filter(Post.id==post.id).first()
    res=serialize_post(post,user.id,db); await manager.broadcast({"type":"post_updated","post":res}); return res

@app.get("/dm/{friend_id}")
def get_dm(friend_id:int,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    if not users_are_friends(db,user.id,friend_id): raise HTTPException(status_code=403,detail="Solo puedes chatear con amigos aceptados.")
    msgs=db.query(DirectMessage).filter(or_(and_(DirectMessage.sender_id==user.id,DirectMessage.receiver_id==friend_id),and_(DirectMessage.sender_id==friend_id,DirectMessage.receiver_id==user.id))).order_by(DirectMessage.created_at.asc()).limit(120).all()
    return [serialize_dm(m,user.id,db) for m in msgs]
@app.post("/dm/{friend_id}")
async def send_dm(friend_id:int,p:DirectMessageCreate,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    if not users_are_friends(db,user.id,friend_id): raise HTTPException(status_code=403,detail="Solo puedes chatear con amigos aceptados.")
    dm=DirectMessage(sender_id=user.id,receiver_id=friend_id,content=p.content.strip()); db.add(dm); db.commit(); db.refresh(dm)
    sender=serialize_dm(dm,user.id,db); receiver=serialize_dm(dm,friend_id,db)
    await manager.send_to_user(friend_id,{"type":"direct_message","message":receiver}); await manager.send_to_user(user.id,{"type":"direct_message","message":sender})
    return sender

@app.websocket("/ws")
async def websocket_endpoint(websocket:WebSocket,token:str):
    db=SessionLocal(); user_id=None
    try:
        user=db.query(User).filter(User.token==token).first()
        if not user: await websocket.close(code=1008); return
        user_id=user.id; await manager.connect(user_id,websocket)
        try:
            while True: await websocket.receive_text()
        except WebSocketDisconnect: pass
    finally:
        if user_id: manager.disconnect(user_id,websocket); await manager.broadcast({"type":"presence_updated","user_id":user_id,"online":False})
        db.close()

@app.get("/")
def health(): return {"status":"ok","message":"Círculo Privado V2 API funcionando.","database":"postgresql" if DATABASE_URL.startswith("postgresql") else "sqlite"}
