# Foro Amigos V2

Versión mejorada manteniendo la estética oscura original.

Incluye:
- Buscar usuarios reales.
- Ver perfiles.
- Editar mi perfil.
- Solicitudes de amistad.
- Aceptar o rechazar amigos.
- Amigos conectados y desconectados.
- Chat privado entre amigos aceptados.
- Feed general del grupo.
- Posts con imagen usando Cloudinary.
- Encuestas reales.
- Eventos reales.
- Notificaciones.

## Error de Cloudinary

Si sale `Invalid cloud_name Root`, en Render cambia:

```txt
CLOUDINARY_CLOUD_NAME=Root
```

por tu Cloud Name real de Cloudinary. En tu captura parecía ser algo como:

```txt
dzouw2ol5
```

Confírmalo en Cloudinary > Settings > API Keys.

## Render

Build command:

```bash
pip install -r requirements.txt
```

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Root Directory en Render:

```txt
Foro_Amigos_V2
```

## Netlify

El repo debe tener `netlify.toml` en la raíz. Este ZIP ya lo incluye.
