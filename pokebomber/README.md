# Pokebomber - Grade style Bomberman prototype

Uma variação de movimento no estilo dos Pokémons clássicos, mas dentro de um tabuleiro inspirado em Bomberman. O foco aqui é demonstrar como montar um projeto seguindo a mesma estrutura da pasta `walkers`, porém com uma movimentação travada na grade e coordenadas inteiras.

## Estrutura

```
pokebomber/
├── index.ts          # Lógica do jogo + bootstrap (nenhum JS inline no HTML)
├── index.html        # Canvas + estilos básicos
├── dist/             # Saída do bundler (gerada pelo servidor unificado)
└── README.md         # Este arquivo
```

Assim como em `walkers`, o bundle importa `src/vibi.ts` e `src/client.ts` diretamente do diretório raiz.

## Conceito de movimento

- O mapa é gerado dinamicamente para ocupar ~2/3 da tela padrão de notebook (1366x768), respeitando a grade e adicionando pilares fixos.
- Cada jogador ocupa exatamente um tile inteiro, definido pelos eixos `x` e `y` do estado.
- A cada comando válido o jogador caminha **um** tile por vez. Enquanto está no meio do passo o estado continua armazenando apenas coordenadas inteiras e um contador de progresso. A animação interpolada é aplicada apenas na renderização.
- A ordem determinística de teclas (↑ ← ↓ →) garante que dois clientes diferentes tomem a mesma decisão quando várias teclas estiverem pressionadas ao mesmo tempo.

## Como rodar

1. Suba o servidor WebSocket (na EC2 compartilhada execute `bun run server` dentro de `~/tmp`).
2. Abra o front (GitHub Pages, Vercel etc.). Ele sempre conecta em `wss://game.vibistudiotest.site`.
3. Também é possível sobrescrever o destino adicionando `?ws=wss://meu-endpoint` à URL ou definindo `window.__VIBI_WS_URL__ = "wss://..."` antes de carregar o bundle.
4. Use um apelido de **uma** letra para manter a compatibilidade com o motor Vibi.

## Controles

- **W / S / A / D** ou **setas** para movimentar na grade (um tile por comando).
- Segurar a tecla continua deslocando o personagem enquanto o caminho estiver livre.

## Diferenciais em relação a `walkers`

- Movimento por grade com colisão em blocos sólidos (`#`).
- Tabuleiro ocupa 2/3 da tela típica de notebook e os jogadores são renderizados como bolinhas coloridas alinhadas à grade.
- HUD simples com infos de sala, tick e ping.

Abra múltiplas abas com o mesmo nome de sala para testar o sincronismo multiplayer.

## Fluxo inicial

O HTML agora usa um modal para coletar as informações em duas etapas:

1. Sala: digite o nome desejado ou deixe vazio para gerar um código automático.
2. Apelido: obrigatório ter apenas **1** caractere.
3. Após confirmar, o modal é escondido e o jogo conecta no servidor configurado (`src/config.ts`).

## Conectando ao servidor remoto

O arquivo `src/config.ts` centraliza a URL WebSocket:

- Sempre usa `wss://game.vibistudiotest.site` (atrás do proxy Nginx com TLS).
- Adicione `?ws=wss://seu-endpoint` ou defina `window.__VIBI_WS_URL__` para forçar outro backend sem rebuild.

Assim o mesmo bundle pode ficar hospedado no GitHub Pages usando o servidor distante.
