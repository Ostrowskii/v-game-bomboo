# Snake Rooms

Pequeno modo multiplayer usando o motor Vibi. Cada jogador controla uma cobrinha que se move a cada *tick* e morre ao tocar nas paredes visíveis.

## Estrutura

```
snake/
├── index.html   # Canvas + UI
├── index.ts     # Lógica do jogo e integração com o Vibi
└── dist/        # Bundle gerado automaticamente via `bun build`
```

## Como jogar

1. Execute o servidor (constrói os bundles automaticamente):
   ```bash
   bun run server
   ```
2. Abra [http://localhost:2020/snake/index.html](http://localhost:2020/snake/index.html)
3. Informe a sala (ou deixe em branco para gerar) e um apelido curto.
4. Controle sua cobra com **WASD** ou as **setas**.
5. Pressione **R** para respawnar caso bata na parede.

### Regras extras

- Bater na própria cauda corta todo o corpo daquela peça até o final (você segue vivo, mas menor).
- Colidir com o corpo de outro jogador resulta em morte imediata.

O mapa ocupa 640×360px (~50% de uma tela padrão de notebook) e possui bordas destacadas que matam imediatamente ao serem tocadas.
