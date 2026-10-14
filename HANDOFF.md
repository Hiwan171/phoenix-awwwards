# HANDOFF — Phoenix (projeto Awwwards, meta: Honorable Mention)

Contexto completo para retomar em outra máquina / sessão. Atualizado em 14/10/2026.
Quem retoma (Claude ou humano): leia este arquivo, depois `DESIGN-BRIEF.md`.

## Como rodar em outra máquina
```bash
git clone <url do repositório> && cd <pasta>
cd site && npm install
npm run dev            # http://localhost:5173

# páginas:
#   /               hero (loader -> vórtice de cinza -> fênix -> ignição)
#   /sky.html       céu + fênix (laboratório)
#   /sky.html?toy=1 céu do Shadertoy (o escolhido) atrás da fênix
```
Opcional (QA/ferramentas do GLB): `cd tools && npm install`. Os scripts de QA usam o Chrome
instalado em `C:/Program Files/Google/Chrome/Application/chrome.exe` (ajuste o caminho se for outro).

> A pasta `Awwwards-mcp/` (ferramenta de terceiros) e `node_modules/` NÃO vão no repositório.
> O `phoenix-rigged.glb` (48 MB) também não: regenere com `tools/build-rig.mjs` a partir de
> `assets/source/tripo_pbr_model_*.glb` (comandos no README.md).

## Estado
| Peça | Onde | Estado |
|---|---|---|
| Fênix rigada (52 ossos, clips Flap/Hover/Glide/Idle) | `site/public/models/phoenix-web.glb` (3,3 MB), `phoenix-lite.glb` (2,8 MB). Fonte do rig: original Tripo em `assets/source/` (o `phoenix-rigged.glb` de 48 MB é regenerável) | **pronta** |
| Fogo em GLSL (aprovado) | `site/src/shaders.js` (`SHELL_*`), preset: só chamas, fogo 1.5, comprimento 0.05, bloom 0.46, 3 camadas. Teste isolado: `fire-test.html` na raiz | **pronto** |
| Hero (só o hero, por decisão do usuário) | `site/index.html`, `src/main.js`, `src/stage.js` | funcionando; transição inicial é o foco |
| Céu procedural meu | `site/src/sky.js`, `sky-test.js` | funcional, **não escolhido** |
| Céu Shadertoy XsBXDc | `site/src/toy/sky.glsl` + `src/toy-sky.js` | **escolhido**, entardecer laranja |
| Seções/scroll antigos | `site/_archive/scroll-slice/` | arquivado (não usar sem pedir) |

## Decisões do usuário (não reverter sem perguntar)
1. **Fogo = extensão do GLB, nunca cobre a textura.** Chamas só saem de pele voltada para cima e da silhueta.
2. **Escopo atual: só o hero.** Foco: a transição inicial até a exibição do hero.
3. **Direção da transição "A — a brasa é a semente"** (aprovada, **ainda não implementada**): o progresso
   do carregamento faz a cinza nascer em volta da brasa, sem tela preta, ≤ ~4 s, com opção de pular.
4. **Scrollytelling futuro:** a fênix sobe/voa por cenários com o scroll (céu realista).
5. **Céu: laranja de entardecer realista.** Sem roxo, sem vermelho (ambos rejeitados). Nuvens lentas.
6. Não fazer por iniciativa: trocar textos, travar scroll, adicionar efeitos. **Perguntar antes.**
7. Idioma da conversa: PT-BR. Site: EN.

## Parâmetros afinados (pelo usuário)
- Céu Shadertoy (`sky.glsl`): `SUN_T 14.6`, `CAM_YAW -0.54` (sol atrás do torso), `CLOUD_SPEED 0.30`,
  `SKY_EXPOSURE 0.92`, `SEA_DARK 0.42`, `WATER_RIPPLE 1.0`, `SUN_REFLECTION 0.0`.
- Composição: vinheta `uVig 0.55` em `toy-sky.js`; rim light dourado `?rim=0.85` em `sky-test.js`.
- Câmera do hero: `S.camR 2.5`, enquadramento deslocado à direita em telas largas.

## Pendências (ordem sugerida)
1. **Licença/autor do shader XsBXDc.** Shadertoy usa CC BY-NC-SA 3.0 por padrão. Antes de submeter:
   conferir no Shadertoy e dar crédito (no código e/ou rodapé). Se for NC e o site tiver caráter comercial,
   usar o céu procedural (`sky.js`) em vez dele.
2. **Performance.** Usuário mediu 27–28 fps nesta máquina (alvo 60). Causa NÃO diagnosticada. Medir na
   máquina nova; se ainda baixo: `WATER_RIPPLE 0.0`, `?res=0.5`, qualidade do céu menor, fogo/bloom off.
3. **Integrar o céu ao hero.** Hoje o hero é fundo preto (void). Desenhar a transição preto → entardecer.
4. **Implementar a transição inicial (direção A).**
5. Depois: Atos II–V (ver `DESIGN-BRIEF.md`), textos finais (os atuais são rascunho), tipografia, mobile,
   reduced-motion e fallback sem WebGL (código existe, NÃO foi testado), medição Lighthouse.

## Armadilhas já encontradas (economize tempo)
- `skeleton.boneMatrices` é realocado pelo three após o 1º render: nunca use `.length` como stride.
- Um único pixel NaN/Inf no céu HDR apaga a tela inteira via UnrealBloomPass: sanitizar a saída do shader.
- Textura de ruído do Shadertoy: `G(uv) = R(uv − (37,17))`. Sinal trocado = nuvens quadriculadas.
- GSAP `lagSmoothing(0)`: a intro é por relógio de parede.
- O Shadertoy bloqueia navegador automatizado (Cloudflare): o código do shader veio colado pelo usuário.
- Vermelho vs. vermelho: o problema de contraste da fênix é de **luminosidade**, não de matiz.

## Ferramentas (pasta `tools/`)
`build-rig.mjs` (esqueleto + pesos + clips), `optimize.mjs` (WebP + Meshopt), `verify.mjs`, `qa.mjs`
(captura com tempo congelado: `PAGE=sky.html EXTRA="&toy=1&t=8" node qa.mjs prefixo 1280 720 x`),
`live.mjs` (execução em tempo real), `render.mjs`/`project.mjs` (previews em CPU).
