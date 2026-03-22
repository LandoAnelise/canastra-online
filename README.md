# 🃏 Canastra Online

Jogo de Canastra online para 2 duplas (4 jogadores), em tempo real via WebSocket.

---

## Regras implementadas

- **2 baralhos** (104 cartas), sem joker
- **13 cartas** por jogador
- **Coringas:** todos os 2s (valem 10 pts)
- **Pontuação das cartas:** Ás=15 | 7 a K=10 | 3 a 6=5 | 2=10
- **Canastras:** Limpa=200 pts | Suja=100 pts
- **Primeira baixa:** qualquer combinação válida (mín. 3 cartas do mesmo rank)
- **Pegar o lixo:** sempre permitido, exceto com 1 carta na mão e 1 no lixo
- **Bater:** precisa de ≥1 canastra + bônus de 50 pts
- **Quem não bateu:** perde o valor das cartas na mão (negativo)
- **Vitória:** primeira dupla a atingir **2000 pontos**
- **Ordem:** alternada entre duplas (J1→J2→J3→J4...)

---

## Instalação e uso

### 1. Instalar dependências

```bash
cd canastra
npm install
```

### 2. Iniciar o servidor

```bash
npm start
```

O servidor sobe em `http://localhost:3000`

### 3. Para desenvolvimento (auto-reload)

```bash
npm run dev
```

---

## Como jogar

1. Abra `http://SEU_IP:3000` no navegador
2. Digite seu nome e um **código de sala** (ex: `FAMILIA01`)
3. Compartilhe o código com os outros 3 jogadores
4. O jogo começa automaticamente quando os 4 entrarem

**Dica:** você pode passar o link `http://SEU_IP:3000?sala=CODIGODANOME` direto para os outros!

---

## Estrutura do projeto

```
canastra/
├── server.js              # Servidor Node.js + Socket.io
├── package.json
├── src/
│   └── GameEngine.js      # Lógica completa do jogo
└── public/
    ├── index.html         # Interface do jogo
    ├── css/
    │   └── style.css      # Estilos
    └── js/
        └── game.js        # Lógica do cliente
```

---

## Customizar porta

```bash
PORT=8080 npm start
```

## Hospedagem com PM2 (recomendado para servidor)

```bash
npm install -g pm2
pm2 start server.js --name canastra
pm2 save
pm2 startup
```
