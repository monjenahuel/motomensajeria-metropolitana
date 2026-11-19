# Matriz de Pugh — Evaluación de alternativas arquitectónicas

**Estado:** Matriz de decisión para el escenario 3B; valoraciones basadas en supuestos arquitectónicos, sujetas a validación con pruebas y estimaciones.

## Método

Todas las alternativas se comparan contra el mismo baseline: **monolito modular**. En esta comparación, sus módulos se comunican mediante llamadas directas, como se detalla más abajo; el nombre no implica que todos los monolitos modulares deban funcionar así.

- **+1:** ventaja respecto al baseline.
- **0:** desempeño comparable respecto al baseline.
- **−1:** desventaja respecto al baseline.

Se conserva la escala básica vista en la materia. Como extensión, se ponderan los criterios según su importancia para el escenario: 1 (menor prioridad relativa), 2 (prioridad intermedia) y 3 (máxima prioridad). Los pesos reflejan una decisión argumentada del equipo, no mediciones objetivas.

El **total ponderado** es la suma de peso × puntaje. No se muestra el total sin ponderar en la matriz para evitar que oculte las prioridades explícitas del escenario.

Los puntajes expresan juicios comparativos fundamentados, no mediciones ni garantías de cumplimiento. Los requisitos obligatorios deben verificarse por separado: una suma favorable no compensa su incumplimiento.

### Restricciones de la consigna (verificación previa a comparar puntajes)

En `adr/consigna.md` se expresan dos restricciones distintas:

1. **Agregar módulos nuevos sin tocar lo que ya funciona:** concreta el NFR estrella de extensibilidad. Se evalúa también como criterio comparativo en la matriz, pero es una restricción obligatoria: un puntaje alto en otras filas no compensa su incumplimiento.
2. **No llamar al servicio pago de mapas por cada reporte de ubicación:** restricción de costo sobre el flujo GPS, independiente de la extensibilidad. Todas las alternativas pueden cumplirla si mantienen y distribuyen las posiciones sin invocar mapas por ping; por sí sola no favorece a un estilo arquitectónico. Debe verificarse aparte (consultas a mapas derivadas de GPS = 0). El criterio «Costo de infraestructura» compara otros costos y no sustituye esta comprobación.

La consigna no exige textualmente cero tiempo de parada para incorporar un módulo; ese objetivo adicional está formulado en `NFR.md` y se debe identificar como decisión de diseño propia, no como cita de la consigna.

## Baseline: monolito modular

Alternativa de referencia hipotética para el mismo dominio, carga y requisitos que las demás opciones:

- Una aplicación backend desplegada como una unidad, organizada en módulos de Envíos, Tracking, Notificaciones e Integración con Mapas.
- Interfaces explícitas entre módulos y llamadas internas síncronas, en el mismo proceso; no llamadas HTTP entre módulos.
- Una base de datos relacional compartida, con propiedad lógica de tablas por módulo y posibilidad de transacciones locales cuando corresponde.
- Sin broker de eventos para integrar los módulos. Las reacciones a una operación se coordinan mediante llamadas directas.
- Puede mantener posiciones GPS en memoria o caché y enviar actualizaciones por SSE/WebSocket. La comunicación síncrona interna no obliga a usar polling en el frontend ni a almacenar cada ping en la base transaccional.
- Puede usar índices, caché, timeouts y réplicas de la aplicación completa. La evaluación debe contemplar la coordinación necesaria si se agregan réplicas.
- Los cuatro equipos pueden trabajar sobre módulos diferentes, pero comparten la unidad de despliegue y deben coordinar su integración.
- Las dependencias externas, como el proveedor de mapas, se mantienen para todas las alternativas.

El baseline recibe cero en todos los criterios por ser la referencia, no porque carezca de capacidades.

## Matriz de evaluación

| Criterio | Peso | Monolito modular (baseline) | Monolito modular + EDA | Microservicios síncronos | Microservicios + EDA |
|---|---:|---:|---|---|---|
| ★ Tiempo real | 3 | 0 | 0 | +1 | +1 |
| ★ Extensibilidad — sin tocar lo existente | 3 | 0 | 0 | 0 | +1 |
| Extensibilidad — nuevas funcionalidades | 1 | 0 | +1 | +1 | +1 |
| Disponibilidad y aislamiento de fallos | 2 | 0 | 0 | 0 | +1 |
| Trabajo en equipo — reparto de responsabilidades | 1 | 0 | +1 | +1 | +1 |
| Trabajo en equipo — coordinación entre equipos | 1 | 0 | 0 | 0 | +1 |
| Escalabilidad | 1 | 0 | 0 | +1 | +1 |
| Costo de infraestructura — servicios y persistencia | 1 | 0 | 0 | -1 | -1 |
| Costo de infraestructura — mensajería | 1 | 0 | 0 | 0 | -1 |
| Complejidad operativa — servicios | 1 | 0 | 0 | -1 | -1 |
| Complejidad operativa — mensajería | 1 | 0 | 0 | 0 | -1 |
| Consistencia de datos | 1 | 0 | 0 | -1 | -1 |
| **Total ponderado** | — | **0** | **2** | **3** | **7** |

Las ★ identifican los NFR estrella de la consigna y se muestran primero. La otra fila de extensibilidad aparece junto a ellas para explicar ambas en conjunto; las demás filas están ordenadas por peso. El resultado expresa una preferencia relativa bajo los supuestos descritos, no una medición de desempeño. Las alternativas que no satisfagan las restricciones obligatorias se conservan como comparación, pero no son elegibles para la decisión final aunque sumen puntos.

### Alcance de monolito modular + EDA

Se mantiene una única unidad de despliegue, igual que en el baseline. Los módulos publican y consumen eventos internos en el mismo proceso, sin broker externo ni consumidores desplegados por separado.

Los eventos desacoplan al emisor de los módulos que reaccionan, pero no implican por sí mismos ejecución asíncrona: los manejadores pueden ejecutarse durante la llamada original o diferirse mediante una cola interna. Para evaluar ventajas de latencia se debe explicitar cuál de estas modalidades se propone.

Esta alternativa comparte el ciclo de despliegue y el proceso con todos sus módulos. Una cola únicamente en memoria no garantiza conservar eventos ante una caída del proceso.

## Criterio 1: Tiempo real

### Qué se evalúa

Capacidad de satisfacer los objetivos de latencia bajo la carga definida en `NFR.md`:

- Propagación de cambios de estado al cliente: p95 ≤ 2 s y p99 ≤ 4 s, con hasta 1.200 observadores concurrentes.
- Confirmación de telemetría: p95 ≤ 200 ms y p99 ≤ 400 ms a 120 reportes/s, contemplando ráfagas de 600 reportes/s en el diseño.

Se evalúan los objetivos observables, sin imponer el broker mencionado en la descripción de la solución actual como condición para comparar alternativas.

### Análisis inicial del baseline

El monolito modular puede recibir GPS, actualizar una caché y transmitir posiciones mediante SSE/WebSocket. Sus llamadas internas evitan los saltos de red entre servicios. Por lo tanto, no corresponde asumir que incumple tiempo real por ser monolítico o síncrono.

Si la respuesta de una operación espera llamadas lentas a mapas o notificaciones, aumenta su latencia. Debe definirse qué trabajo integra el camino crítico antes de comparar.

### Aspectos considerados al comparar las alternativas

- **Monolito modular + EDA:** ¿sacar reacciones secundarias del camino crítico mejora la métrica requerida? El procesamiento asíncrono puede acelerar la confirmación, pero las colas también pueden demorar la actualización visible al cliente.
- **Microservicios síncronos:** ¿el aislamiento de Tracking aporta una ventaja bajo la carga prevista que compense los saltos de red y las esperas síncronas?
- **Microservicios + EDA:** ¿la separación de Tracking y el procesamiento asíncrono permiten sostener las latencias objetivo bajo carga? El desacoplamiento no garantiza menor latencia extremo a extremo.

### Valoraciones acordadas

- **Monolito modular + EDA: 0.** Ambos monolitos pueden transmitir actualizaciones mediante SSE/WebSocket y procesar telemetría con baja latencia. Los eventos internos aportan desacoplamiento, pero no justifican por sí solos una mejora en los tiempos de respuesta.
- **Microservicios síncronos: +1.** Separar Tracking, con recursos asignados independientemente, reduce la interferencia de la telemetría y las conexiones en vivo sobre el núcleo transaccional de Envíos, favoreciendo el mantenimiento de las latencias objetivo bajo la carga prevista.
- **Microservicios + EDA: +1.** Ofrece el mismo beneficio de aislamiento de recursos de Tracking. La ventaja evaluada proviene de esa separación, no de una garantía de menor latencia por utilizar RabbitMQ.

Estos puntajes expresan una ventaja arquitectónica esperada, pendiente de validación con pruebas de carga. No implican que 120 reportes/s saturen necesariamente al monolito. Se supone asignación independiente de recursos y un camino de telemetría que no dependa de llamadas síncronas al núcleo por cada reporte; separar contenedores sin controlar recursos no elimina toda competencia. Aquí se evalúa la interferencia sobre la latencia bajo la carga prevista; en escalabilidad se evaluará la capacidad de crecer independientemente.

### Redis en la comparación

Redis puede utilizarse tanto desde microservicios síncronos como desde el monolito modular. Una única unidad de despliegue de la aplicación no impide utilizar infraestructura externa, como una base de datos o una caché. Para una comparación equivalente, su uso como caché de posiciones GPS está disponible para todas las alternativas.

Por lo tanto, incorporar Redis no justifica por sí solo un +1 para microservicios. Una posible ventaja diferencial sería aislar los recursos de Tracking y escalarlo independientemente de Envíos para sostener la latencia bajo carga; debe fundamentarse respecto de los objetivos de tiempo real, considerando también el costo de las llamadas de red. Usar Redis Pub/Sub para comunicar servicios introduciría comunicación por eventos y debe distinguirse de su uso como caché en la alternativa síncrona.

**Valoración:** tiempo real **0 / 0 / +1 / +1**, en orden baseline, monolito modular + EDA, microservicios síncronos y microservicios + EDA.

## Criterio 2: Extensibilidad

### Dos aspectos diferentes

La facilidad general de incorporar funcionalidades (por ejemplo, Facturación, Premios o Analítica) se separa de la restricción explícita de `adr/consigna.md`: agregar módulos sin tocar lo que ya funciona. La primera fila evalúa modularidad y autonomía para desarrollar la funcionalidad; la segunda se centra en integrar una funcionalidad nueva sin modificar componentes existentes. Por ese motivo se propone peso 1 para la facilidad general y peso 3 para el requisito específico, en lugar de mantener peso 3 en ambas filas. `NFR.md` agrega el objetivo de hacerlo sin paradas, que se verificará por separado.

Ambas filas pertenecen al **NFR estrella Extensibilidad**. La ★ marca la restricción específica de ese NFR en la matriz; **★ Tiempo real** figura asimismo como criterio propio.

### Nuevas funcionalidades (peso propuesto: 1)

- **Monolito modular (baseline): 0.** Sus interfaces y módulos permiten extender la aplicación, pero agregar una reacción a un evento del negocio normalmente exige conectar el nuevo módulo con el existente y volver a desplegar la aplicación completa. El baseline no es «no extensible»; es la referencia relativa.
- **Monolito modular + EDA: +1.** Los eventos internos permiten conectar nuevos módulos sin agregar llamadas directas desde el productor; se mantiene un único despliegue.
- **Microservicios síncronos: +1.** Contratos explícitos y despliegue independiente facilitan desarrollar un nuevo servicio, aunque integrarlo con cambios de Envíos puede requerir modificar el productor.
- **Microservicios + EDA: +1.** Los contratos de eventos y el despliegue independiente facilitan incorporar funcionalidades nuevas.

### Sin tocar el sistema existente (peso propuesto: 3)

Se compara el caso de agregar una funcionalidad que necesita reaccionar a hechos del negocio. Un +1 exige poder integrarla **sin modificar los componentes existentes**, aprovechando contratos de eventos ya publicados. El requisito adicional de desplegar sin paradas se documenta en `NFR.md`, pero no forma parte de la literalidad de la consigna.

- **Baseline: 0.** Referencia: hay que conectar el módulo nuevo mediante llamadas y desplegar de nuevo la aplicación.
- **Monolito modular + EDA: 0.** Puede reaccionar a eventos internos sin modificar el productor, pero añadir el módulo implica cambiar y redesplegar la aplicación existente, dado que es una única unidad de despliegue.
- **Microservicios síncronos: 0.** Puede desplegarse el nuevo servicio aparte, pero para reaccionar a nuevos hechos habitualmente hay que añadir una llamada desde el productor o adoptar polling sobre una interfaz existente; no se asegura el escenario completo.
- **Microservicios + EDA: +1.** El nuevo servicio puede suscribirse a eventos existentes sin cambiar los componentes ya operativos, siempre que el contrato publicado contenga la información necesaria y se mantenga compatible.

Un 0 en la segunda fila significa que no se demuestra una ventaja respecto al baseline **para el requisito completo**; no borra las ventajas parciales registradas en la primera. La separación de filas permite reflejar la diferencia sin cambiar la escala de la materia.

## Criterio 3: Trabajo en equipo (4 equipos)

### Reparto de responsabilidades (peso propuesto: 1)

Se valora si los cuatro equipos pueden desarrollar y probar áreas funcionales en paralelo con límites claros. Frente al baseline, los eventos internos definen puntos de integración entre módulos y los microservicios definen contratos entre componentes desplegables: se propone **0 / +1 / +1 / +1**. El baseline también permite asignar módulos a equipos; el +1 representa una mejora relativa en la separación de responsabilidades, no la imposibilidad de trabajar en paralelo en un monolito modular.

### Coordinación entre equipos (peso propuesto: 1)

Se valora específicamente cuánto deben sincronizar los equipos sus **pruebas de integración, versiones de contratos y calendarios de entrega** cuando varias funcionalidades evolucionan en paralelo. No se puntúa aquí la capacidad de incorporar un módulo sin modificar componentes existentes, que ya se evalúa en Extensibilidad.

- **Baseline: 0.** Los cuatro equipos comparten integración y calendario de despliegue.
- **Monolito modular + EDA: 0.** Los eventos internos pueden mejorar la comunicación entre módulos, pero mantienen la misma unidad de integración y despliegue del baseline.
- **Microservicios síncronos: 0.** Permiten entregas independientes, pero los cambios en APIs solicitante/proveedor y los flujos de llamadas entre equipos exigen coordinar versiones y pruebas de integración. Se propone un 0 conservador para el efecto neto sobre la coordinación, no porque toda entrega requiera un despliegue conjunto.
- **Microservicios + EDA: +1.** Con eventos publicados y contratos compatibles, los equipos pueden evolucionar consumidores y probarlos con menor coordinación de calendarios con el productor. Siguen siendo necesarios acuerdos de esquema, observabilidad y responsabilidades sobre el broker.

**Cautela:** el +1 diferencial no es automático por usar EDA. Hay que sostenerlo con contratos estables y autonomía real de los equipos. La primera fila cubre el reparto de responsabilidades; la segunda, el costo de coordinar integraciones entre equipos existentes; la restricción de sumar módulos sin tocar componentes ya operativos permanece exclusivamente en la fila de Extensibilidad. Se asigna peso 1 a coordinación para reducir el solapamiento potencial con el criterio de extensibilidad.

## Criterio 4: Disponibilidad y aislamiento de fallos

Se compara si una falla de un módulo secundario, por ejemplo Notificaciones o Analítica, interrumpe la operación principal de Envíos. El escenario 5.2 de `NFR.md` pide que Envíos siga operando mientras el módulo caído se recupera y procesa los eventos pendientes.

- **Monolito modular (baseline): 0.** Las llamadas internas pueden propagar fallos o esperas al flujo principal; un fallo no controlado del proceso afecta a todos los módulos. Es la referencia, no un sistema necesariamente carente de manejo de errores.
- **Monolito modular + EDA: 0.** Los eventos internos desacoplan el código, pero los módulos comparten proceso y despliegue. Una excepción puede aislarse mediante manejo adecuado, aunque una cola en memoria no asegura retener eventos si el proceso cae. No hay una mejora de disponibilidad garantizada frente al baseline.
- **Microservicios síncronos: 0.** Separar procesos aísla una caída local, pero si el núcleo espera la respuesta del servicio caído, los errores y timeouts pueden propagarse al flujo principal. En esta valoración conservadora, esa ventaja y ese riesgo se compensan. Con timeouts, circuit breakers y degradación explícita podría justificarse otro puntaje.
- **Microservicios + EDA: +1.** Una cola durable por consumidor permite que Notificaciones o Analítica fallen sin bloquear las operaciones principales; al recuperarse, pueden procesar mensajes pendientes. Esta ventaja supone publicación confiable, confirmaciones de consumo, capacidad y monitoreo del broker e idempotencia. RabbitMQ introduce una dependencia operativa: la disponibilidad del productor y la no pérdida de eventos no quedan garantizadas por EDA por sí sola.

**Valoración propuesta:** **0 / 0 / 0 / +1**. Se evalúa el aislamiento de fallas secundarias respecto del núcleo, no la disponibilidad absoluta de toda la infraestructura.

## Criterio 5: Escalabilidad

Se valora la capacidad de aumentar recursos solo en la parte exigida por el crecimiento de telemetría y conexiones en vivo, sin multiplicar necesariamente los recursos del núcleo transaccional. No se puntúa aquí la latencia bajo la carga actual, tratada en Tiempo real.

- **Monolito modular (baseline): 0.** Puede replicarse la aplicación completa, pero no escalar Tracking por separado. La coordinación de sesiones, posiciones y conexiones debe resolverse entre réplicas.
- **Monolito modular + EDA: 0.** Los eventos internos no cambian la unidad de escalado; se replica la aplicación completa.
- **Microservicios síncronos: +1.** Tracking puede replicarse y dimensionarse independientemente de Envíos, con almacenamiento compartido y distribución de conexiones adecuados.
- **Microservicios + EDA: +1.** Comparte la ventaja de escalado independiente de Tracking; las colas pueden amortiguar ráfagas para consumidores, aunque acumular mensajes no garantiza cumplir los objetivos de latencia ni elimina los límites de capacidad del broker.

**Valoración acordada:** **0 / 0 / +1 / +1**. La ventaja diferencial procede del límite de despliegue y escalado, no de que EDA sea inherentemente más rápida.

## Criterio 6: Costo de infraestructura

La consigna establece nube con pago por uso; no fija un techo de gasto, pero cada recurso adicional tiene costo. Se separa el costo de alojar servicios y persistencia independientes del de operar un broker para mensajería. Cada fila tiene peso propuesto 1, en lugar de contar ambos factores juntos dos veces con peso 2. Estas valoraciones son expectativas relativas, no una estimación de facturación: deberían validarse mediante un presupuesto con recursos y consumo previstos.

### Servicios y persistencia (peso propuesto: 1)

Se compara el costo base de las unidades desplegables y su persistencia. Para ambas variantes de microservicios se asume **Database-per-Service**, como en `adr/0003-database-per-service.md`: almacenamiento y gestión de datos separados por propietario. No implica necesariamente una instancia física de PostgreSQL por cada servicio; los costos concretos dependen del aislamiento elegido. No incluye broker ni consultas pagas a mapas.

- **Baseline: 0.** Una unidad de aplicación y una base relacional compartida, con caché externa opcional para GPS.
- **Monolito modular + EDA: 0.** Los eventos internos no requieren otra unidad de despliegue ni otra base por sí mismos.
- **Microservicios síncronos: -1.** Varios servicios y almacenes de datos bajo propiedad separada aumentan el costo base de cómputo, persistencia y respaldo, aunque pueden dimensionarse por separado y ahorrar recursos en ciertas cargas.
- **Microservicios + EDA: -1.** Comparten los costos de servicios y datos independientes; el broker se considera únicamente en la segunda fila.

### Mensajería (peso propuesto: 1)

Se compara el gasto incremental de infraestructura de mensajería entre servicios; no el esfuerzo del equipo para operarla, que corresponde a «Complejidad operativa».

- **Baseline: 0; monolito modular + EDA: 0; microservicios síncronos: 0.** Ninguno necesita un broker por definición. Una caché externa, si se usa para GPS en cualquiera de estas alternativas, se presupuesta para todas en condiciones comparables.
- **Microservicios + EDA: -1.** RabbitMQ y su almacenamiento, red, monitoreo y capacidad de recuperación suponen un costo adicional. El tamaño y el precio dependen de la implementación y del proveedor cloud.

**Valoración propuesta:** servicios y persistencia **0 / 0 / -1 / -1** y mensajería **0 / 0 / 0 / -1**. Así se distingue a MS + EDA como la opción potencialmente más costosa sin ampliar la escala. Keycloak y cualquier caché de GPS necesaria se comparan en condiciones equivalentes; no se atribuye a microservicios un costo exclusivo por componentes que también puede necesitar el monolito. La restricción de no consultar mapas por cada ping GPS se verifica por separado: no depende de escoger monolito o microservicios.

## Criterio 7: Complejidad operativa

Se retira «tiempo de desarrollo»: la consigna no impone un plazo y no hay datos para estimarlo de manera comparable. Aquí se evalúa el esfuerzo de desplegar, supervisar, diagnosticar y recuperar el sistema **en operación**, no la factura de infraestructura (criterio de costo) ni el esfuerzo de implementar las funcionalidades. Se proponen dos filas de peso 1 cada una, en lugar de una fila de peso 2 que ocultaría la diferencia entre las alternativas de microservicios.

### Servicios (peso propuesto: 1)

- **Baseline: 0; monolito modular + EDA: 0.** Una unidad de despliegue de la aplicación; los eventos internos pueden complicar el diagnóstico dentro del código, pero no exigen operar otro servicio o broker por definición.
- **Microservicios síncronos: -1; microservicios + EDA: -1.** Más unidades desplegables, configuración y persistencia por servicio, monitoreo distribuido y procedimientos de recuperación; la coordinación de llamadas entre servicios difiere, pero el esfuerzo adicional básico afecta a ambas variantes.

### Mensajería (peso propuesto: 1)

- **Baseline: 0; monolito modular + EDA: 0; microservicios síncronos: 0.** No requieren operar un broker entre servicios en las configuraciones comparadas.
- **Microservicios + EDA: -1.** Debe administrarse el broker y observar colas, reintentos, mensajes fallidos, consumidores atrasados y contratos de eventos. Este puntaje mide tareas operativas, no el costo monetario del broker ya registrado en infraestructura.

**Valoración propuesta:** servicios **0 / 0 / -1 / -1** y mensajería **0 / 0 / 0 / -1**. El nivel de esfuerzo real varía según los servicios administrados que provea la nube y la automatización del despliegue.

## Criterio 8: Consistencia de datos

Se evalúa la facilidad de mantener coherentes datos que pertenecen a capacidades distintas (por ejemplo, la asignación de un envío en Envíos y su proyección en Tracking). No se evalúa la integridad transaccional **dentro** de Envíos: su base de datos puede seguir ofreciendo transacciones ACID en cualquiera de las cuatro alternativas.

- **Monolito modular (baseline): 0.** Los módulos pueden coordinar cambios en una base relacional compartida y, cuando es apropiado, usar una transacción local. Es la referencia; las transacciones entre módulos también pueden aumentar el acoplamiento.
- **Monolito modular + EDA: 0.** Los eventos internos pueden publicarse y procesarse dentro de la misma transacción si son síncronos, o requerir consistencia eventual si se procesan después. EDA interno no obliga a abandonar la consistencia fuerte; se propone 0 bajo el supuesto de conservar transacciones locales para invariantes críticas.
- **Microservicios síncronos: -1.** Database-per-Service impide una transacción local única sobre Envíos y Tracking. Una llamada HTTP inmediata no vuelve atómicas dos escrituras en bases distintas; se necesitan compensaciones, conciliación o limitar invariantes a un único propietario.
- **Microservicios + EDA: -1.** También hay datos separados; las proyecciones se actualizan eventualmente y deben manejar duplicados, retrasos y mensajes fuera de orden. La persistencia de Envíos y la publicación del evento requieren una estrategia confiable (por ejemplo, outbox). No se asigna una penalización adicional frente a MS síncronos porque ambas alternativas pierden atomicidad entre servicios, aunque sus mecanismos y tiempos de convergencia sean diferentes.

**Valoración propuesta:** **0 / 0 / -1 / -1**. La consistencia eventual de las vistas secundarias es un compromiso explícito; estados e invariantes críticas deben tener un propietario transaccional. El criterio no implica que las alternativas de microservicios permitan datos incorrectos por diseño.
