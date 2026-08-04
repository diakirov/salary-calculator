# Деплой

Сценарій: піддомен → VPS, на якому вже працюють інші сервіси. Ліміти в compose підібрані так, щоб калькулятор за жодних умов їм не заважав.

## 0. DNS (разово, руками в реєстратора)

A-запис піддомена → IP сервера. TTL будь-який. MX/пошту не чіпати — піддомен на них не впливає.

## 1. Секрети (разово)

```bash
# на сервері, в каталозі проєкту
cat > secrets.env <<'EOF'
SESSION_SECRET=<openssl rand -hex 32>
# по одному рядку на кожну роль із config.json (ключ `roles`):
# ім'я змінної = AUTH_<РОЛЬ_ВЕЛИКИМИ>_HASH
AUTH_ADMIN_HASH=<argon2-хеш>
AUTH_MANAGER_HASH=<argon2-хеш>
AUTH_STAFF_HASH=<argon2-хеш>
EOF
```

Хеш згенерувати локально:

```bash
node -e "import('argon2').then(a=>a.default.hash(process.argv[1]).then(console.log))" 'пароль'
```

`secrets.env` у git не потрапляє (гітігнорений). Хеш ≠ пароль: витік хеша не віддає пароль, але тримати їх у секреті все одно.

## 2. Дані (разово)

```bash
mkdir -p data
scp config/config.json  server:/opt/salary-calculator/data/config.json
scp -r branding/        server:/opt/salary-calculator/data/branding/
```

`data/` — гітігнорений волюм: реальні ставки і бренд живуть лише на сервері.

## 3. Запуск

```bash
docker compose up -d --build
curl -s 127.0.0.1:8093/api/me   # → {"error":"Потрібен вхід"} = живий
```

## 4. Reverse proxy

Якщо на сервері вже є проксі — додати vhost туди. Якщо немає, Caddy:

```
calc.example.com {
    reverse_proxy 127.0.0.1:8093
}
```

Caddy сам отримує TLS-сертифікат. Ніяких портів назовні, крім 80/443 самого проксі: контейнер слухає тільки 127.0.0.1.

## 5. Перевірка ізоляції

```bash
docker stats --no-stream    # калькулятор ≤256 МБ / ≤0.35 CPU
docker compose down         # сусідні сервіси не мають навіть моргнути
```

## Оновлення ставок

Не деплой: адмін-паролем на сайті → Адмінка → нова версія «застосувати з дати».
Конфіг лежить у `data/config.json`, кожен запис бекапиться в `data/backups/`.

## Оновлення коду

```bash
git pull && docker compose up -d --build
```
