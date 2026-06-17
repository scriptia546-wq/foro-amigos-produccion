# Foro Amigos V3

Versión mejorada con:
- Login/registro en modal real.
- Composer inline, sin ventanas del navegador.
- Publicaciones con imagen, archivo, encuesta y evento.
- Guardados, descargas, compartir, comentarios y likes.
- Perfil editable.
- Buscar usuarios, solicitudes de amistad y chat privado para amigos.
- Chat privado con texto, enlaces, imágenes, archivos y encuesta simple.

## Render
Build Command:

```txt
pip install -r requirements.txt
```

Start Command:

```txt
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Root Directory: vacío.

## Netlify
Base directory: vacío.
Build command: vacío.
Publish directory: .

## Cloudinary
En Render → Environment pon:

```txt
CLOUDINARY_CLOUD_NAME=tu_cloud_name_real
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
```

No coloques `Root` en CLOUDINARY_CLOUD_NAME. En tu cuenta se ve como algo parecido a `dzouw2ol5`.
