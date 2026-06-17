# Círculo / Foro Amigos V4

Proyecto completo con frontend estático para Netlify y backend FastAPI para Render.

## Archivos incluidos

- `index.html`
- `styles.css`
- `script.js`
- `main.py`
- `requirements.txt`
- `netlify.toml`
- `.env.example`

## Render

Crear un **Web Service** conectado al repositorio.

Configuración:

- Root Directory: dejar vacío si los archivos están en la raíz.
- Build Command:

```bash
pip install -r requirements.txt
```

- Start Command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Variables de entorno en Render:

```env
CLOUDINARY_CLOUD_NAME=dzouw2ol5
CLOUDINARY_API_KEY=TU_API_KEY
CLOUDINARY_API_SECRET=TU_API_SECRET
CORS_ORIGINS=https://TU-SITIO.netlify.app,http://localhost:5500
DATABASE_URL=sqlite:///./circulo.db
```

Para producción real, usa PostgreSQL en `DATABASE_URL`.

## Netlify

Subir los archivos del frontend al repositorio y conectar Netlify.

`netlify.toml`:

```toml
[build]
publish = "."
```

En `script.js`, cambia esta línea si tu backend Render tiene otro dominio:

```js
const API_BASE = (window.CIRCULO_API_URL || localStorage.getItem('CIRCULO_API_URL') || 'https://foro-amigos-produccion.onrender.com').replace(/\/$/, '');
```

Pon tu URL real de Render, por ejemplo:

```js
'https://foro-amigos-produccion.onrender.com'
```

## Cloudinary

No pongas `Root` como Cloud Name.
El Cloud Name real es el que sale arriba en Cloudinary, por ejemplo:

```env
CLOUDINARY_CLOUD_NAME=dzouw2ol5
```
