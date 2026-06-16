# Foro Amigos Producción

Proyecto listo para desplegar:

- Backend: FastAPI + SQLAlchemy + PostgreSQL/SQLite fallback + WebSockets + Cloudinary.
- Frontend: HTML/CSS/Vanilla JS listo para Netlify.
- Imágenes: subida a Cloudinary desde `/upload`.

## Backend en Render

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Variables de entorno en Render:

- DATABASE_URL
- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET
- MAX_UPLOAD_BYTES opcional

## Frontend en Netlify

Antes de subir a Netlify, abre `script.js` y pega tu URL de Render:

```js
const RENDER_BACKEND_URL = "https://tu-backend.onrender.com";
```

Luego sube estos archivos al deploy de Netlify:

- index.html
- styles.css
- script.js

## Prueba local

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

Luego abre `index.html`.

Usuario demo:

- usuario: rodrigo
- contraseña: 1234
