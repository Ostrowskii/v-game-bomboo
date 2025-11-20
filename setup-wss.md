## Preparando o backend Vibi para servir WSS

Este guia descreve tudo que precisa ser feito para o servidor do repositório [VictorTaelin/tmp](https://github.com/VictorTaelin/tmp/tree/main) aceitar conexões seguras (`wss://`). Os passos envolvem tanto ajustes de infraestrutura quanto configuração de software no host que roda o backend.

### 1. Pré‑requisitos externos
1. **Domínio próprio** – Compre/registre um domínio e tenha permissão para alterar seus DNS.
2. **DNS apontando para o servidor** – Crie um registro `A` (IPv4) ou `AAAA` (IPv6) para o domínio/subdomínio que usará com WSS (ex.: `game.seudominio.com`) apontando para o IP público da máquina onde o servidor Bun roda.
3. **Portas liberadas** – Garanta que as portas 80 (HTTP) e 443 (HTTPS) estejam abertas no firewall do provedor (AWS Security Group, etc.). A porta interna onde o servidor WebSocket escuta pode continuar sendo 8080, mas ela precisa ser acessível localmente para o proxy.

### 2. Atualizar o servidor (lado código)
1. **Clonar/atualizar o repositório `tmp`** – Dentro do host, verifique se o código do servidor está em dia (`git pull`).
2. **Instalar dependências** – O servidor é um projeto Bun; instale/atualize o Bun e rode `bun install` se necessário.
3. **Configurar porta interna** – O backend continuará expondo WS simples (`ws://127.0.0.1:8080`). Não há mudanças diretas no código para TLS; o tráfego seguro será terminado no proxy reverso.

### 3. Instalar e configurar um proxy reverso com TLS
A forma mais comum é usar **Nginx** (vale o mesmo conceito para Caddy ou Traefik).

1. **Instalar Nginx**  
   ```bash
   sudo apt update
   sudo apt install nginx
   ```
2. **Criar um arquivo de site** em `/etc/nginx/sites-available/vibi-wss` com o conteúdo:
   ```nginx
   server {
     listen 80;
     server_name game.seudominio.com;
     location /.well-known/acme-challenge/ {
       root /var/www/html;
     }
     location / {
       return 301 https://$host$request_uri;
     }
   }

   server {
     listen 443 ssl http2;
     server_name game.seudominio.com;

     ssl_certificate     /etc/letsencrypt/live/game.seudominio.com/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/game.seudominio.com/privkey.pem;
     ssl_protocols       TLSv1.2 TLSv1.3;

     location / {
       proxy_pass http://127.0.0.1:8080;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   Ajuste o domínio no `server_name` e no caminho dos certificados.
3. **Habilitar o site**  
   ```bash
   sudo ln -s /etc/nginx/sites-available/vibi-wss /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

### 4. Emitir certificados TLS (Let’s Encrypt)
1. Instale o Certbot: `sudo apt install certbot python3-certbot-nginx`.
2. Rode `sudo certbot --nginx -d game.seudominio.com`. Ele cria os certificados e ajusta o arquivo do Nginx automaticamente (ou confirme se o arquivo ficou igual ao passo anterior).
3. Certifique-se de que a renovação automática está configurada (`systemctl status certbot.timer`).

### 5. Manter o processo Bun rodando
1. Crie um serviço `systemd` (ex.: `/etc/systemd/system/vibi.service`) apontando para o comando que sobe o servidor WebSocket (`bun run server`).
2. Habilite e inicie: `sudo systemctl enable --now vibi.service`.
3. Verifique os logs com `journalctl -u vibi.service -f`.

### 6. Ajustar o cliente
1. Com o backend servindo em `wss://game.seudominio.com`, atualize o front para usar o novo endpoint:
   - Sete `window.__VIBI_WS_URL__ = "wss://game.seudominio.com"` antes de carregar o bundle **ou**
   - Adicione `?ws=wss://game.seudominio.com` à URL **ou**
   - Altere os defaults em `src/config.ts` para apontar para o novo domínio.
2. Republique o front (GitHub Pages). Como agora o backend usa WSS, o navegador não bloqueará mais o WebSocket.

### 7. Checklist final
- [ ] DNS resolvendo para o IP correto.
- [ ] Porta 443 aberta e servindo um certificado válido.
- [ ] Proxy reverso repassando upgrade de WebSocket (`Upgrade`/`Connection`).
- [ ] Serviço Bun ativo e respondendo em `localhost:8080`.
- [ ] Cliente configurado para `wss://`.

Seguindo esses passos, o servidor do repositório `tmp` continuará rodando o mesmo código, mas ficará acessível com TLS, atendendo páginas hospedadas em HTTPS (como o GitHub Pages).
