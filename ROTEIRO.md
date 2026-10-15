# Roteiro — "A Cycle in Five Acts" (versão 1, aprovada pelo usuário em 15/10/2026)

Documento de trabalho. Não é o DESIGN-BRIEF (esse sai junto, depois). Aqui só: a história, as cenas, o que cada cena exige de
rig / shader / scroll, e a ordem de construção. Texto do site (EN) fica para depois e não está definido aqui.

## Premissas fechadas com o usuário

- A **fênix** (Zhuque, Fogo, Sul) é a fera principal e visita o mundo de cada fera. Cada mundo tem **um shader como habitat**.
- Ordem dos mundos: **Tartaruga → Tigre → Dragão** (a ordem do Wu Xing que o usuário aprovou).
- A fênix **vence todos, menos o dragão**. Ela morre no confronto final; a **última seção é o renascimento**.
- Movimentos **pré-definidos, presos ao scroll**: rolar para trás desfaz e retrocede o voo e o movimento.
- Mobile entra, com versão reduzida. Poucas seções, para não cansar o júri.
- **Som entra** (o Awwwards avalia som). Ver a seção "Som".
- **Vitória sobre a tartaruga:** aquecer o gelo (aprovado).
- **Morte da fênix:** ela se consome no próprio fogo alimentado pelo dragão; **sem golpe visível** do dragão (aprovado).
- **Final:** só a fênix renascida; as três feras vencidas **não** voltam (aprovado).

## Fio condutor: o ciclo dos elementos conta a história

| Mundo | Fera | Elemento | Como a fênix "vence" (ou perde) |
|---|---|---|---|
| Norte | Tartaruga Negra (Xuanwu) | Água | A Água apaga o Fogo, então ela não vence apagando: **aquece** o mar congelado; o vapor sobe e a tartaruga cede o caminho. |
| Oeste | Tigre Branco (Baihu) | Metal | O Fogo derrete o Metal: a armadura do tigre amolece e escorre; ele recua. |
| Leste | Dragão Azul (Qinglong) | Madeira | A Madeira **alimenta** o Fogo: quanto mais ela queima, mais o dragão a alimenta, até ela se consumir. Aqui ela perde. |
| Centro | — | Terra | O Fogo gera a Terra: das cinzas nasce o ovo / a brasa. **Renascimento.** |

O movimento da história é o próprio ciclo: Água (resiste) → Metal (cede) → Madeira (consome) → Terra (cinza) → Fogo (renasce).

## Cenas (7 seções, ~700 vh de scroll, cerca de 3 a 4 minutos de leitura)

Cada cena ocupa ~100 vh. A câmera e a fênix andam sobre uma linha do tempo única; o scroll é o tempo.

| # | Cena | Scroll | Habitat (shader) | Fênix | Fera local |
|---|---|---|---|---|---|
| 0 | **Abertura** | 0–100 vh | céu de entardecer (o atual), brasas | paira, depois ergue voo | — |
| 1 | **Norte — a Tartaruga** | 100–200 | noite polar, mar congelado, aurora | voo planado, aquece o gelo, pousa perto | tartaruga acorda, ergue a cabeça, cede |
| 2 | **Oeste — o Tigre** | 200–300 | deserto frio de aço, vento de areia | voo batido, ataque de fogo, o metal derrete | tigre avança, recua |
| 3 | **Leste — o Dragão** | 300–420 | floresta em névoa e tempestade verde | encontro, voo em círculos, golpe | dragão enrola, ergue-se, ataca |
| 4 | **A Queda** | 420–520 | o mundo do dragão escurece; só o fogo ilumina | arde cada vez mais forte, perde altura e se consome (dissolve em brasa) — sem golpe do dragão | dragão parado, observando |
| 5 | **Cinza** | 520–600 | terra, silêncio, névoa baixa | só brasas, uma luz no chão | — |
| 6 | **Renascimento** | 600–700 | o céu de abertura, mas outro (alvorada) | nasce do ovo / da brasa, abre as asas, sobe | — (só a fênix; nenhuma outra fera) |

Observações:
- **Cena 3 e 4 juntas** (~220 vh) são o clímax; é onde o público deve parar e olhar.
- Cena 5 é um respiro de propósito (silêncio visual): descanso depois do clímax, antes do final.
- No fim da cena 6 a câmera fecha no céu de abertura: o ciclo fecha em si.

## O que cada cena exige

### Fênix (clipes, todos presos ao scroll)

| Clipe | Cenas | Estado hoje |
|---|---|---|
| Pairar (loop) | 0, 3, 6 | **pronto** (Hover, 2,5 s) |
| Planar, asas abertas | 1 | a fazer |
| Voo batido para a frente (corpo inclina) | 1, 2 | a fazer |
| Curva (asa inclina) | 1, 2, 3 | a fazer |
| Ataque de fogo (asas para trás, rajada) | 2, 3 | a fazer |
| Arder, perder altura, cair (sem golpe) | 4 | a fazer |
| Consumir-se (dissolve em brasa pelo corpo) | 4 | shader de brasa já existe; a ligar ao tempo |
| Renascer (brasa → ovo → abre as asas) | 6 | a fazer |
| **Asa dobrada** (pouso, ovo) | 1, 6 | **risco**: a escultura é de asa aberta |

### Feras locais (um clipe curto cada, preso ao scroll)

- **Tartaruga:** acorda e ergue a cabeça; serpente da casca acompanha.
- **Tigre:** avança, rosna, recua (patas com IK para o pé não deslizar).
- **Dragão:** enrola, se ergue, ataca. É a fera que mais pesa, com a coluna de poucos ossos; vale reforçar cauda e coluna.

### Shaders (habitats)

Hoje só existe o céu da fênix. Faltam quatro (norte, oeste, leste, terra) mais a alvorada. Cada um precisa de um parâmetro de
"estado" ligado ao scroll (intensidade, cor, vento) e de uma transição para o seguinte.

### Scroll / câmera

- Um **motor de linha do tempo**: `progresso (0..1) → pose da fênix, câmera, parâmetros de shader, texto`. Tudo função pura do
  progresso, para rolar para trás funcionar sem estado.
- Movimento secundário (cauda, penas) já é baked, então é reversível. **Física por estado (Verlet) não entra.**
- Uma fera local carregada por vez + a fênix: duas na tela no máximo.

## Som (aprovado; a definir em detalhe)

O Awwwards avalia som, então ele é parte da experiência, não um extra. Proposta de trabalho:

- **Camadas por mundo**, em crossfade pelo scroll (progresso → volume de cada camada): vento de gelo e gelo rangendo (norte),
  vento de areia e metal que vibra (oeste), chuva, trovão distante e madeira (leste), silêncio e um tom grave (cinza), alvorada (final).
- **Fogo**: uma camada de crepitar cuja intensidade segue a mesma `power` do fogo da fênix; a batida das asas segue a fase do clipe.
- **Reversível**: como o resto, o som é função do progresso; rolar para trás o desfaz.
- **Política do navegador**: o áudio só começa após um gesto do usuário. Um interruptor claro (som ligado/desligado) fica sempre
  visível; começa **desligado** até o usuário escolher ou rolar, e o estado é lembrado. Respeitar `prefers-reduced-motion`.
- **Origem**: sem arquivos pesados. Preferir **síntese em Web Audio** (ruído filtrado, osciladores) ou samples curtos com licença
  livre (CC0). Tudo com licença documentada. Orçamento: < 1 MB no total.
- **A definir com o usuário**: sensação geral (cinematográfica sutil? mais musical?), se há uma trilha ou só ambiente.

## Ordem de construção (risco primeiro)

1. **Motor de scroll + fênix pairando reversível** (prova de que rolar para trás funciona; base de tudo).
2. **Teste da asa dobrada** (maior risco técnico; decide o pouso e o renascimento).
3. **Clipes de voo da fênix** (planar, batido, curva, ataque).
4. **Primeiro mundo completo (Tartaruga)**: shader + fera + coreografia. Serve de molde para os outros.
5. **Mundos 2 e 3** (Tigre, Dragão) com o molde.
6. **Clímax**: luta, queda, consumir-se.
7. **Cinza e renascimento.**
8. **Som**: camadas por mundo, interruptor, ligação ao fogo e à batida.
9. **Polimento**: transições entre mundos, mobile, desempenho (as duas feras juntas), acessibilidade (reduced motion).

## Pendências que não são de construção

- **Licença do Meshy** (plano usado) e do **shader do céu** (Shadertoy): conferir antes de publicar.
- **Texto do site (EN):** vem depois do roteiro aprovado; cada cena ganha uma frase curta.
- **Arquivos fonte** de 66 MB fora do Git: combinar onde guardar.
- **DESIGN-BRIEF:** escrever junto, com este roteiro como base.

## Decisões fechadas (15/10/2026)

1. A tartaruga cede porque a fênix **aquece o gelo** (sem luta direta).
2. A morte é a fênix **se consumindo**, alimentada pelo dragão; o dragão não a golpeia.
3. **Há som**, com interruptor (ver "Som").
4. O final tem **só a fênix renascida**.
5. Ordem dos mundos: Tartaruga, Tigre, Dragão. A fênix vence todos menos o dragão.
6. Movimento preso ao scroll; rolar para trás desfaz o voo e o movimento.
7. Mobile com versão reduzida. Sete seções.

## Ainda em aberto

- Sensação do som (ambiente sutil ou mais musical).
- Texto EN de cada cena (uma frase curta por cena), depois do roteiro estável.
- Licença do Meshy (plano usado) e do shader do céu.
