// Registro del Service Worker y recepción de mensajes (Tema 5.2 y Tema 5.3 - Fragmento G)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });
}

// Indicador visual del estado de red
function actualizarIndicadorRed() {
  const badge = document.getElementById('badge-red');
  if (!badge) return;

  if (navigator.onLine) {
    badge.textContent = 'En Línea';
    badge.className = 'badge online';
  } else {
    badge.textContent = 'Sin Conexión';
    badge.className = 'badge offline';
  }
}

// Captura de Mutaciones Fallidas (CREATE) y Registro de Etiqueta sync (Tema 5.2 Fragmento B + Tema 5.3 Fragmento E)
function procesarEnvioReporte(datosFormulario) {
  const endpoint = 'https://jsonplaceholder.typicode.com/posts';

  return fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datosFormulario)
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      // Envío exitoso en vivo: registrar en bitácora local como sincronizado
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      })
        .then(() => {
          // Detección de soporte para Background Sync API
          if ('serviceWorker' in navigator && 'SyncManager' in window) {
            return navigator.serviceWorker.ready
              .then((registro) => {
                console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
                return registro.sync.register('sync-reportes');
              });
          }
        });
    })
    .then(() => {
      // Actualizar la lista visual en ambos escenarios
      return renderizarColaOutbox();
    });
}

// Barrido y Reenvío de Pendientes como Fallback para navegadores sin SyncManager (Tema 5.2 Fragmento C + Tema 5.3)
function sincronizarPendientesFallback() {
  console.log('[Outbox] Conexión detectada. Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Convertir cada registro pendiente en una promesa de envío + actualización
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch('https://jsonplaceholder.typicode.com/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        })
          .then((res) => {
            if (!res.ok) throw new Error('Falla al reintentar envío');
            // Actualizar estado en IndexedDB de 'pendiente' a 'sincronizado'
            return actualizarEstadoRegistro(item.id, 'sincronizado');
          });
      });

      // Esperar a que todos los reenvíos concluyan
      return Promise.all(promesasDeEnvio);
    })
    .then(() => {
      return renderizarColaOutbox();
    })
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

// 1. Desafío de Ensamblado: Función renderizarColaOutbox() (READ)
function renderizarColaOutbox() {
  const lista = document.getElementById('lista-outbox');
  if (!lista) return Promise.resolve();

  return obtenerTodosLosRegistros()
    .then((registros) => {
      lista.innerHTML = '';

      registros.forEach((item) => {
        const li = document.createElement('li');
        li.className = `item-outbox ${item.estado}`;

        const fecha = new Date(item.fechaCreacion).toLocaleTimeString();
        li.innerHTML = `
          <div>
            <strong>${item.titulo}</strong>
            <p>${item.descripcion}</p>
            <small>Hora: ${fecha}</small>
          </div>
          <span class="estado-badge ${item.estado}">${item.estado}</span>
        `;

        lista.appendChild(li);
      });
    })
    .catch((error) => {
      console.error('[Outbox] Error al renderizar la cola:', error);
    });
}

// 2. Desafío de Ensamblado: Conexión del Formulario (submit)
const formIncidencia = document.getElementById('form-incidencia');
if (formIncidencia) {
  formIncidencia.addEventListener('submit', (e) => {
    e.preventDefault();

    const inputTitulo = document.getElementById('titulo');
    const inputDescripcion = document.getElementById('descripcion');

    const datosFormulario = {
      titulo: inputTitulo.value.trim(),
      descripcion: inputDescripcion.value.trim()
    };

    procesarEnvioReporte(datosFormulario)
      .then(() => {
        formIncidencia.reset();
      });
  });
}

// 3. Desafío de Ensamblado: Purga de Registros Enviados (DELETE)
const btnPurgar = document.getElementById('btn-purgar');
if (btnPurgar) {
  btnPurgar.addEventListener('click', () => {
    obtenerTodosLosRegistros()
      .then((registros) => {
        const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
        const promesasEliminacion = sincronizados.map((item) => eliminarRegistro(item.id));
        return Promise.all(promesasEliminacion);
      })
      .then(() => {
        return renderizarColaOutbox();
      })
      .catch((error) => {
        console.error('[Outbox] Error al purgar registros sincronizados:', error);
      });
  });
}

// Prevención de Condiciones de Carrera en el Evento online (Tema 5.3 - Fragmento F)
window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Degradación elegante: Solo sincronizar desde UI si el navegador NO soporta Background Sync (ej. Safari/iOS)
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// Inicialización al cargar la página
document.addEventListener('DOMContentLoaded', () => {
  actualizarIndicadorRed();
  renderizarColaOutbox();
});