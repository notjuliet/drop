# drop

A minimal file sharing app with zero-knowledge storage.

## Features

- Client-side encryption (AES-256-GCM)
- Multiple files upload
- Configurable file expiry
- Burn after read
- Optional sensitive-content warning
- Preview for images, video, audio, and text

## Running

Requires [Bun](https://bun.sh).  
See `.env.example` for configuration.

```sh
bun start
```

For development with hot reload:

```sh
bun dev
```
