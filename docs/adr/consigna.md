## 3B · Operador logístico metropolitano
**Dominio 3 · Mensajería en moto**

---

### El problema
Una empresa de mensajería en moto hace envíos para comercios y estudios contables. Los clientes crean envíos, los operadores los asignan a los cadetes, y los cadetes actualizan el estado (retirado, en camino, entregado, no se pudo entregar). El cliente recibe un aviso en cada cambio de estado.

---

### Común a los dos escenarios del dominio

| Concepto | Detalle |
| :--- | :--- |
| **Roles** | Cliente (crea y sigue envíos), cadete (actualiza estados), operador (asigna envíos) |
| **Sistema externo a simular** | Servicio de mapas y geocodificación (convierte direcciones en coordenadas y estima tiempos; cobra por consulta) |
| **Caso de uso mínimo** | Un operador asigna un envío a un cadete y el cliente ve el cambio de estado. |

---

### Este escenario: 3B · Operador logístico metropolitano

| Concepto | Detalle |
| :--- | :--- |
| **Escala** | 600 cadetes, unos 15.000 envíos por día; cada cadete reporta su ubicación cada 5 segundos y los clientes siguen el envío en un mapa en vivo. |
| **Quién lo mantiene** | 4 equipos. En los próximos meses se suman facturación automática, premios para cadetes y analítica, cada módulo desarrollado por un equipo distinto. |
| **Infraestructura y presupuesto** | Nube con pago por uso. |
| **NFR estrella** | **Tiempo real y extensibilidad.** |
| **La restricción que lo cambia todo** | **Los módulos nuevos se tienen que poder sumar sin tocar lo que ya funciona. Y como el servicio de mapas cobra por consulta, no se lo puede llamar en cada reporte de ubicación.** |

---

*Se diseña el sistema completo para la escala del escenario, pero solo se implementa el corte: login + el caso de uso mínimo (u otro equivalente, si lo justifican). Elegir un escenario chico no es más fácil: se evalúa la coherencia entre el escenario y las decisiones.*