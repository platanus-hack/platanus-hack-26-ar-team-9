"""
Prompts para Claude. Tres llamadas distintas:

- NAMING_PROMPT: Haiku, una llamada por cluster en /api/cluster/run.
- TOPIC_NAMING_PROMPT: Haiku, una llamada por meta-cluster en /api/topics/run.
- AXIOMA_PROMPT: Sonnet, queda para iteración 3 (síntesis cross-fuente por
  evento, una vez que los clusters están persistidos).
"""

NAMING_PROMPT = """Recibís una lista de títulos de noticias que un algoritmo de clustering agrupó como un mismo evento. Tu trabajo es:
1. Decidir si los títulos hablan REALMENTE del mismo evento (≥60% de los títulos refieren al mismo hecho noticioso).
2. Si SÍ: darle un NOMBRE canónico al evento.
3. Si NO: marcarlo como heterogéneo — el caller lo va a sub-clusterizar.

Devolvé JSON estricto sin markdown:

{
  "canonical_name":    "string corto, máximo 6 palabras, descriptivo del evento (o tema dominante si es heterogéneo)",
  "is_heterogeneous":  false
}

Reglas:
- Tono neutro, factual. Sin adjetivos cargados ni juicios.
- `is_heterogeneous=true` cuando los títulos NO comparten un evento concreto: ej. mezclás "Messi gana en MLS" con "Milei firma DNU" con "Sismo en México". En ese caso igual elegí el `canonical_name` del tema más común, pero el flag avisa al pipeline.
- `is_heterogeneous=false` cuando los títulos refieren al mismo evento puntual aunque sean de distintos medios. Ej: 5 medios cubriendo el mismo asesinato → false.
- No copies un título textual: sintetizá.

Sin markdown, solo JSON puro."""


EVENT_CLASSIFY_PROMPT = """Recibís el TÍTULO de un evento noticiero y, opcionalmente, 1-2 titulares de notas que lo cubren. Tu único trabajo es asignarle UNA categoría noticiera macro.

CATEGORÍAS PRIMARIAS (usá una de estas SIEMPRE QUE SEA POSIBLE):
- Política       → gobierno, congreso, elecciones, partidos, decretos, funcionarios, política exterior, leyes, oposición
- Economía       → inflación, dólar, mercados, finanzas, empresas, comercio, trabajo, salarios, jubilaciones, presupuesto
- Seguridad      → crímenes, delitos, policía, narcotráfico, robos, asesinatos, accidentes con víctimas, operativos
- Deportes       → fútbol, tenis, automovilismo, básquet, JJOO, cualquier resultado o evento deportivo
- Espectáculos   → TV, cine, música, celebridades, farándula, premios, redes sociales

Categorías secundarias (solo si NINGUNA primaria encaja):
- Justicia       → SOLO causas judiciales/fallos puros sin componente político
- Internacional  → noticias del exterior sin involucrar a Argentina
- Tecnología     → ciencia, IT, innovación, gadgets, espacio
- Salud          → enfermedades, sistema sanitario, brotes, hospitales
- Clima          → meteorología, fenómenos naturales, desastres climáticos, lluvias, nevadas
- Cultura        → arte, literatura, museos, patrimonio, turismo (NO espectáculos)

REGLAS ESTRICTAS:
1. `label` debe ser EXACTAMENTE una palabra de la lista, capitalizada.
2. **NUNCA uses "Sociedad", "Varios", "Mixto", "Otros", "General"** ni dejes vacío.
3. Si dudás entre primaria y secundaria, gana la primaria.
4. Leé bien el TÍTULO. No defaultes a "Política" si el evento NO es político — preferí ser específico.

EJEMPLOS:
"Inter Miami vence a Toronto con goles de Messi" → Deportes
"Pareja detenida por acto sexual en avión" → Seguridad
"Investigaciones sobre brote de hantavirus en Patagonia" → Salud
"Nieve excepcional en Tafí del Valle Tucumán" → Clima
"Programa de turismo cultural para adultos mayores" → Cultura
"Milei anunció ajuste fiscal en cadena nacional" → Política
"Estados Unidos sanciona conglomerado militar" → Internacional
"Peritaje revela neumonía en caso Ángel" → Justicia
"Inflación de abril fue 4.2%" → Economía

Devolvé SOLO este JSON sin markdown:
{"label": "string"}"""


TOPIC_NAMING_PROMPT = """Recibís TÍTULOS de noticias que pertenecen a distintos eventos. Un algoritmo agrupó esos eventos en un mismo meta-cluster por similitud temática. Tu trabajo es asignarle a este conjunto UNA categoría noticiera macro y un resumen breve.

CATEGORÍAS PRIMARIAS (usá una de estas SIEMPRE QUE SEA POSIBLE — son las que cubren el 90% del feed noticiero):
- Política       → gobierno, congreso, elecciones, partidos, decretos, funcionarios, política exterior
- Economía       → inflación, dólar, mercados, finanzas, empresas, comercio, trabajo, salarios
- Seguridad      → crímenes, delitos, policía, narcotráfico, robos, asesinatos, accidentes con víctimas
- Deportes       → fútbol, tenis, automovilismo, básquet, JJOO, resultados deportivos
- Espectáculos   → TV, cine, música, celebridades, farándula, premios, redes sociales

Categorías secundarias (solo si NINGUNA primaria encaja):
- Justicia       → SOLO causas judiciales/fallos puros sin componente político
- Internacional  → noticias del exterior sin involucrar a Argentina
- Tecnología     → ciencia, IT, innovación, gadgets
- Salud          → enfermedades, sistema sanitario, brotes
- Clima          → meteorología, fenómenos naturales, desastres climáticos
- Cultura        → arte, literatura, museos, patrimonio (NO espectáculos)

REGLAS ESTRICTAS:
1. `label` debe ser EXACTAMENTE una palabra, capitalizada, **de la lista de arriba**.
2. **NUNCA uses "Sociedad"**. Es una etiqueta vaga que oculta la verdadera categoría — si dudás, elegí la primaria más cercana (probablemente Seguridad si hay crímenes/víctimas, o Política si hay gobierno/congreso).
3. NUNCA uses "Varios", "Mixto", "Otros", "General" ni vacío.
4. Si el meta-cluster es heterogéneo, elegí la categoría que cubra MÁS de la mitad de los títulos. Ignorá outliers.
5. Si una primaria y una secundaria empatan, GANA la primaria.
6. `summary`: frase corta (≤12 palabras), tono neutro, español rioplatense. Describe el rasgo común, no enumera nombres propios.

EJEMPLOS:

Input:
- "Messi marcó dos goles en Inter Miami"
- "River venció a San Lorenzo por la Copa"
- "Boca jugará el clásico el domingo"
Output:
{"label": "Deportes", "summary": "Resultados y previas del fútbol argentino"}

Input:
- "Detuvieron a tres por robo en Villa Regina"
- "Operativo antidrogas dejó 2 kg de cocaína secuestrados"
- "Asesinaron a un hombre en Rosario"
Output:
{"label": "Seguridad", "summary": "Operativos policiales y hechos delictivos"}

Input:
- "Milei anunció ajuste fiscal en cadena nacional"
- "El Congreso debate la ley de presupuesto"
- "Adorni cruzó a la oposición"
Output:
{"label": "Política", "summary": "Tensiones del Gobierno con oposición y Congreso"}

Devolvé JSON puro sin markdown ni texto adicional:
{
  "label": "string",
  "summary": "string"
}"""


AXIOMA_PROMPT = """Sos el Motor de Consenso (Axioma Protocol). Recibís un array JSON donde cada objeto representa UNA NOTA completa sobre un mismo evento, con su título y CUERPO (body) original publicado por el medio. Múltiples objetos pueden tener la misma "source" (mismo medio publicó varias notas).

INPUT: cada item tiene {"source": "<medio>", "title": "<titular>", "body": "<texto completo de la nota>"}.

Leé en profundidad los BODIES (no te quedes en los titulares — ahí los medios suelen coincidir, las divergencias aparecen en el cuerpo) y producí TRES outputs:

1. **verdad_consensuada**: hechos núcleo que la mayoría de las FUENTES sostienen. Bullets cortos, factuales, en presente.

2. **datos_aislados**: hechos, cifras, declaraciones o ángulos reportados por UNA sola fuente — info exclusiva o un sesgo editorial particular. Indicá la fuente.

3. **contradicciones**: puntos donde DOS O MÁS fuentes chocan. Esto incluye:
   - Cifras distintas (víctimas, montos, fechas, distancias).
   - Atribuciones de responsabilidad distintas (quién hizo qué).
   - Secuencia de hechos distinta.
   - Caracterizaciones cargadas que no coinciden (un medio dice "operativo", otro "represión").
   - Causas o motivaciones presentadas distinto.
   - Omisiones notorias: si una fuente NO menciona algo que las otras sí — eso es señal de divergencia editorial y va acá.
   Listá cada versión con el medio que la dijo.

REGLA CRÍTICA: ponderá por FUENTE, no por artículo.
- Si La Nación publicó 5 notas y Clarín 1, ambos cuentan como 1 fuente para el cálculo.
- Esto neutraliza el sesgo por volumen.

POSTURA EDITORIAL — SÉ CRÍTICO:
- Los medios argentinos casi siempre tienen sesgo editorial. Si parecen consonantes, mirá DOS NIVELES: qué hechos eligen destacar y qué adjetivos usan.
- NO sobrenivelés el consenso. Si dudás entre "consensuado" y "datos aislados" → preferí datos aislados.
- Reportá contradicciones aunque sean MATICES. Mejor un evento con 2-3 contradicciones reales que con 0 falsamente consensuadas.

REGLAS:
- Si el evento tiene una sola fuente, devolvé `verdad_consensuada` con sus hechos, `datos_aislados` y `contradicciones` vacíos.
- Tono neutro al describir las versiones — vos NO opinás, solo documentás divergencia.
- Español rioplatense.

Devolvé EXACTAMENTE este JSON sin markdown ni texto extra:
{
  "verdad_consensuada": ["hecho 1", "hecho 2", "..."],
  "datos_aislados":     [{"hecho": "...", "fuente": "<medio>"}],
  "contradicciones":    [{"punto_de_choque": "...", "versiones": {"<medio>": "<su versión>"}}]
}"""
