# Hero — cena piloto aprovada

Base visual: o vídeo `WhatsApp Video 2026-10-20 at 15.40.16.mp4`, recuperado do commit `78a8d4f`.
Céu vermelho, sol baixo, dois picos e a travessia da fênix formam a identidade aprovada. A página de trabalho é
`/opening-lab.html`; `/ascension.html` é outro experimento.

## Mapa da cena

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Cena | `site/src/opening-lab.js` | Renderer, luz, dois picos, céu, trajetória, câmera, scroll e integração das animações |
| Paisagem | `site/src/worlds/opening-landscape.js` | Relevo, cordilheiras, vale escavado, pedras e os mesmos triângulos usados pelo contato |
| Rocha | `site/src/worlds/opening-rock.js` | Material PBR fotográfico com projeção triplanar, normais e margens molhadas |
| Lago | `site/src/worlds/opening-water.js` | Reflexo planar HDR da cena, ondulações, Fresnel, absorção e margens recortadas pelo terreno |
| Céu vivo | `site/src/worlds/ember-sky.js` | Estrelas com pulsação individual e cometas em chamas, caudas turbulentas e pequenas brasas, atrás da cena |
| Trajeto | `site/src/beasts/flight-path.js` | Curva por comprimento de arco e interpolação suave dos parâmetros do voo |
| Postura | `site/src/beasts/fenix-flight.js` | Coluna, asas, pernas, cauda, crista e cadeias de penas |
| Dedos | `site/src/beasts/fenix-toe-guides.js`, `fenix-feet.js` | Articulações próprias, pesos, pernas alcançando apoios independentes e dedos acompanhando a pedra |
| Camadas das costas | `site/src/beasts/fenix-plumage.js` | Movimento limitado das partes livres, raízes e pontos de contato presos, com a mesma deformação na sombra e na máscara de chamas |
| Aparência | `site/src/beasts/fenix-look.js` | Paleta de fogo, emissão, luz atravessando as penas, respiração e tremulação fina |
| Brasas | `site/src/beasts/fenix-embers.js` | Partículas emitidas das penas, que ficam no mundo e seguem o vento |
| Pós | `site/src/hero-post.js` | Máscara de silhueta, chamas, bloom, tone mapping e escala de resolução |
| Folga da cauda | `site/src/beasts/fenix-clearance.js`, `opening-clearance-data.js` | Medição da malha contra a pedra e correções pré-calculadas |

## Decisões para o movimento

O progresso da história controla posição, câmera, batidas de asa, decolagem e pouso. O tempo contínuo controla vento,
respiração, olhar, piscar e movimentos pequenos das penas. Assim, a cena continua viva quando o visitante para de rolar,
e o trajeto continua reversível.

Os pés são a referência imóvel enquanto a ave sustenta o próprio peso. O vento atua acima da bacia; cada perna alcança
seu apoio e cada dedo articula sem alterar o comprimento dos ossos. A correção de postura põe as solas sobre os cumes,
em vez de tentar alcançar uma face íngreme com os dedos esticados.

As penas precisam de movimentos diferentes: as camadas curtas mexem pouco, penas externas têm atraso, cauda e crista
respondem mais às rajadas. As raízes ficam presas ao corpo e as sobreposições precisam continuar fechadas. A direção do
vento deve concordar nas penas, nas brasas e nas chamas.

O céu preserva o gradiente vermelho e o sol aprovados. Estrelas em posições fixas pulsam em ritmos diferentes, com
algumas mais luminosas. Os cometas cruzam trajetórias no céu, com núcleo quente, cauda de fogo e fragmentos que se apagam.
As passagens são ocasionais e seguem o tempo contínuo, inclusive quando a fênix está parada. Os efeitos usam a profundidade
da cena e o bloom existente. Em movimento reduzido, o campo de estrelas permanece estático e os cometas não passam.

Comparação visual: `?skyfx=0` desliga a camada celestial; `?stars=0` e `?comets=0` isolam os efeitos. A primeira passagem
começa aproximadamente dois segundos após o início da página. QA e capturas: `node tools/verify-ember-sky.mjs`.

## Paisagem e percurso — 20/10/2026

A travessia descreve um arco de aproximadamente 86 m, ganha altura sobre o vale e retorna ao rochedo de chegada.
A câmera abre na saída, revela o lago durante o planeio e volta ao pouso. O autoplay termina apoiado, sem reiniciar,
a menos que `loop` esteja ligado. Preview: `/opening-lab.html?play=1&dur=45&ui=0`.

O relevo tem encostas erodidas, canal sinuoso escavado e cordilheiras até 620 m de extensão. As superfícies dos dois
apoios permanecem calibradas; `surfaceAt` acompanha os triângulos efetivamente desenhados. A malha base não cobre os
interiores dos apoios finos. Pedras instanciadas ocupam superfícies secas de inclinação moderada.

A rocha usa **Rock Face**, fotografia de Greg Zaal, processamento de Dario Barresi, [Poly Haven / CC0](https://polyhaven.com/a/rock_face).
Arquivos locais em `site/public/textures/opening-rock`, 2K na versão completa e 1K na leve, sem requisições externas.
`tools/prepare-opening-rock.mjs` reproduz os derivados. Os mapas são projetados em metros de mundo;
as margens ficam escuras e menos ásperas junto à água.

O lago reflete o mundo com câmera espelhada e plano de corte, em target HDR de 512 px (256 na leve).
O fundo amostrado da própria paisagem determina profundidade e recorte das margens; as ondulações seguem o tempo
contínuo e ficam paradas quando movimento reduzido está ativo. `?water=0` compara o vale sem a água.
Estrelas e fragmentos ajustam o tamanho ao viewport de reflexão.

O detalhe de normais e mapas extras diminui suavemente entre 18 e 30 m; o reflexo usa uma versão simplificada da rocha.
A malha da água retém apenas células próximas ao lago. Na Intel UHD local, 1280×720 sem MSAA, as medições de GPU ficaram
em aproximadamente 21–26 ms em resolução integral e 14 ms no plano do lago com escala 0,72, disponível no governador
existente. Esses tempos medem a renderização; não equivalem a uma garantia de FPS no navegador.

Validação: `node tools/verify-opening.mjs` para a fênix e `node tools/verify-opening-landscape.mjs` para os triângulos,
folga de voo/câmera, lago visível e animado, recursos locais, movimento reduzido e término do autoplay.
Mudanças no relevo ou caminho exigem `node tools/bake-opening-clearance.mjs` antes da avaliação dos contatos.
O trajeto final passou também por 101 progressos e três fases de vento com folga mínima da cauda de 15 mm na versão completa.

Os mapas `.bin` da plumagem já estão versionados e não precisam ser reconstruídos para rodar a cena. Caso seja necessário
recriá-los numa máquina nova, faça `git lfs pull`, instale as dependências de `tools`, execute
`node tools/meshy-test/rig-feathers.mjs` e depois `node tools/meshy-test/bake-plumage.mjs` na raiz. O primeiro comando
recria o intermediário ignorado `model/meshy-test/Fenix_rig.glb` a partir do original versionado `model/fenix/Fenix-RIG.glb`.

## Próximos refinamentos de maior impacto

1. **Hierarquia da luz.** O sol branco e o bloom disputam atenção com cabeça e cauda nos contraluces. Ajustar esse brilho
   local para preservar detalhes das penas e a leitura da fênix sobre o céu vermelho.
2. **Câmera com intenção.** Dar tempo ao apoio inicial, à decolagem e ao pouso; manter o planeio como uma passagem calma.
   Avaliar reduzir a troca de lado da câmera entre `u=0.52` e `u=0.62`.
3. **Enquadramento por proporção de tela.** A câmera atual foi composta para desktop. Ajustar a distância em telas estreitas
   e conferir asas, cabeça, dedos e ponta da cauda em todas as fases antes de definir a composição mobile.
4. **Interface do hero.** Substituir os controles de laboratório por uma entrada e uma indicação de scroll discretas quando
   a coreografia estiver aprovada. Tipografia e texto devem ocupar espaço deixado pela composição.
5. **Entrega.** Medir custo real em desktop e celular, respeitar movimento reduzido e preparar carregamento e fallback
   visual. O build padrão ainda publica apenas a entrada principal; incluir a abertura quando ela assumir o hero final.

As prioridades acima partem da avaliação visual e técnica desta cena e orientam o refinamento da identidade aprovada.
