# Intro "a brasa é a semente" (arquivada em 14/10/2026)

Hero com fundo preto e a transição inicial: brasa no mundo → cinza nasce com o carregamento (`uBirth`) → vórtice →
silhueta → dissolução em baixo-para-cima → ignição. Tudo funcionando e testado (144 fps, pular com Esc/Espaço/Enter).

Arquivada porque o usuário pediu para eliminar a transição de início e reformulá-la com o céu como cenário do hero.
Para reaproveitar: os shaders `ASH_*` / `EMBER_*` continuam em `src/shaders.js`, e o patch de revelação é
`patchPhoenixMaterial(mat, U, { reveal: true })` em `src/phoenix-material.js`.

**15/10/2026:** `src/shaders.js` e `src/phoenix-material.js` saíram da árvore junto com a fênix v2 (ver HANDOFF). Para
reaproveitar a abertura: `git show 0a0f28f:site/src/shaders.js` (e `phoenix-material.js`, `plumage.js`).

Arquivos: `main.js` (boot + timeline GSAP), `stage.js` (cinza, brasa, revelação, aura), `index.html`, `style.css`
(estado em que estavam, com a fênix v2 e a aura). Não são importados por nada em `src/`.
