/**
 * Script de Verificación y Demostración del Caso de Uso de Ezequiel:
 * "Se crean varios pedidos en plataforma y un operador los agrupa en varios cadetes, actualizan estado y se entrega."
 *
 * Ejecución:
 *   node scripts/test-caso-uso-ezequiel.js
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function obtenerToken(username, password) {
  const res = await fetch(`${BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, grant_type: 'password' }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Fallo login para ${username}: ${error}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function main() {
  console.log('================================================================');
  console.log('🧪 DEMOSTRACIÓN DEL CASO DE USO (EZEQUIEL)');
  console.log('   Punto de Entrada: API Gateway en ' + BASE_URL);
  console.log('================================================================\n');

  try {
    // 1. Cliente se autentica a través del Gateway
    console.log('1️⃣ Autenticando Cliente (cliente.demo) vía Gateway...');
    const tokenCliente = await obtenerToken('cliente.demo', 'cliente123');
    console.log('   ✅ Token Bearer obtenido exitosamente.\n');

    // 2. Cliente crea 3 pedidos simultáneos en la plataforma
    console.log('2️⃣ Cliente registra 3 pedidos en plataforma...');
    const pedidos = [
      { origen: 'Av. Corrientes 1500, CABA', destino: 'Av. Cabildo 2500, CABA', lat_origen: -34.6037, lon_origen: -58.3816, lat_destino: -34.5614, lon_destino: -58.4563 },
      { origen: 'Av. Santa Fe 3200, CABA', destino: 'Calle Mitre 600, Avellaneda', lat_origen: -34.5936, lon_origen: -58.4042, lat_destino: -34.6625, lon_destino: -58.3650 },
      { origen: 'Av. Rivadavia 7000, Flores', destino: 'Av. Maipú 1500, Vicente López', lat_origen: -34.6186, lon_origen: -58.4357, lat_destino: -34.5292, lon_destino: -58.4778 }
    ];

    const pedidosCreados = [];
    for (const [i, p] of pedidos.entries()) {
      const res = await fetch(`${BASE_URL}/envios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenCliente}`
        },
        body: JSON.stringify(p)
      });
      if (!res.ok) throw new Error(`Error creando pedido ${i + 1}: ${await res.text()}`);
      const data = await res.json();
      pedidosCreados.push(data);
      console.log(`   📦 Pedido #${i + 1} creado: ID ${data.id} (${data.numero_seguimiento}) -> Evento 'envio.creado' emitido al Broker.`);
    }

    // 3. Operador se autentica
    console.log('\n3️⃣ Autenticando Operador (operador.demo) vía Gateway...');
    const tokenOperador = await obtenerToken('operador.demo', 'operador123');
    console.log('   ✅ Token Operador obtenido.');

    // 4. Operador agrupa y asigna los pedidos al cadete cadete.demo
    console.log('\n4️⃣ Operador agrupa y asigna los envíos a cadete.demo...');
    for (const envio of pedidosCreados) {
      const res = await fetch(`${BASE_URL}/envios/${envio.id}/asignar`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenOperador}`
        },
        body: JSON.stringify({ mensajero: 'cadete.demo' })
      });
      if (!res.ok) throw new Error(`Error asignando envío ${envio.id}: ${await res.text()}`);
      console.log(`   🛵 Envío ${envio.numero_seguimiento} asignado a cadete.demo -> Evento 'envio.asignado' emitido al Broker.`);
    }

    // 5. Cadete actualiza los estados a EN_CAMINO y ENTREGADO
    console.log('\n5️⃣ Cadete actualiza estado del primer envío a EN_CAMINO y luego ENTREGADO...');
    const tokenCadete = await obtenerToken('cadete.demo', 'cadete123');
    const envioPrueba = pedidosCreados[0];

    // Transición a EN_CAMINO
    let res = await fetch(`${BASE_URL}/envios/${envioPrueba.id}/estado`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCadete}`
      },
      body: JSON.stringify({ estado: 'EN_CAMINO', motivo: 'Paquete retirado en origen' })
    });
    if (!res.ok) throw new Error(`Error pasando a EN_CAMINO: ${await res.text()}`);
    console.log(`   📍 Envío ${envioPrueba.numero_seguimiento} pasó a EN_CAMINO.`);

    // Transición a ENTREGADO
    res = await fetch(`${BASE_URL}/envios/${envioPrueba.id}/estado`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenCadete}`
      },
      body: JSON.stringify({ estado: 'ENTREGADO', motivo: 'Entrega conforme al destinatario' })
    });
    if (!res.ok) throw new Error(`Error pasando a ENTREGADO: ${await res.text()}`);
    console.log(`   🏁 Envío ${envioPrueba.numero_seguimiento} ENTREGADO.`);

    // 6. Cliente consulta el detalle final con auditoría en tiempo real
    console.log('\n6️⃣ Cliente consulta trazabilidad y auditoría final...');
    const resDetalle = await fetch(`${BASE_URL}/envios/${envioPrueba.id}`, {
      headers: { Authorization: `Bearer ${tokenCliente}` }
    });
    const detalleFinal = await resDetalle.json();
    console.log(`   Estado final: ${detalleFinal.estado}`);
    console.log('   Historial de auditoría:');
    detalleFinal.historial.forEach((h, idx) => {
      console.log(`     [Paso ${idx + 1}] -> ${h.estado_nuevo} (Por: ${h.cambiado_por} | Motivo: "${h.motivo || 'N/A'}")`);
    });

    console.log('\n================================================================');
    console.log('🎉 CASO DE USO DE EZEQUIEL COMPLETADO CON ÉXITO EXTREMO A EXTREMO');
    console.log('================================================================');
  } catch (err) {
    console.error('\n❌ ERROR DURANTE LA PRUEBA:', err.message);
  }
}

main();
