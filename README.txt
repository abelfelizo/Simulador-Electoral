Simulador Electoral FP 2028 (Web)

Cómo correrlo local:
1) Abre una terminal en esta carpeta.
2) Ejecuta un servidor simple:

Python 3:
  python3 -m http.server 8000

Luego abre:
  http://localhost:8000

Notas:
- Los datos están en data/base_data.json (agregados por territorio, año y nivel).
- El mapa usa assets/dominican-republic.svg.
- Diputados usa D'Hondt con curules (defaults 2024) y permite ajustar vía código (state.seatsByProvCirc).


========================
INSTRUCCIONES PARA CORRER (MAC / SAFARI / CHROME)
========================

1) Descomprime el ZIP en una carpeta local.
2) Abre Terminal en esa carpeta (o navega con cd).
3) Ejecuta un servidor local:

Opción A (Python 3):
  python3 -m http.server 8000

Opción B (Node, si tienes):
  npx http-server -p 8000

4) Abre en el navegador:
  http://localhost:8000

IMPORTANTE:
- No abras el HTML directo (file://) porque Safari/Chrome bloquean fetch() de base_data.json.
- Siempre usa un servidor local o GitHub Pages.

========================
PROTOCOLO DE ACTUALIZACIÓN (GitHub)
========================

Estructura recomendada del repo:
  /
   index.html
   style.css
   app.js
   VERSION.txt
   /data/base_data.json
   /assets/dominican-republic.svg
   /docs (opcional: documentación y notas)

Flujo recomendado:
1) Rama main: versión estable publicada (GitHub Pages).
2) Rama dev: cambios en curso.
3) Cada actualización -> incrementa VERSION.txt y agrega nota en CHANGELOG.md.

Actualizaciones típicas:
A) Encuestas nuevas:
   - En el simulador, activa "Encuestas (modo override)".
   - Carga los números.
   - Pulsa "Guardar" en 'Encuestas guardadas'.
   - Eso guarda el escenario en la memoria del navegador (localStorage) para ese usuario/equipo.
   - Para compartir con otro equipo o mantenerlo en GitHub:
       - Exporta el escenario (botón export si lo usas) o
       - Copia el JSON de la encuesta desde localStorage y pégalo en un archivo:
           data/polls_store.json
     (Si quieres, puedo convertir el store a archivo compartible por defecto).

B) Tabla de escaños 170 (cuando la publique la JCE):
   - Si la tabla oficial viene en Excel/PDF, se convierte a un mapa 'prov-circ' -> seats.
   - Se pega en 'Editar tabla (manual)' o se reemplaza en base_data.json como defaults.
   - Cambia seatsMode por defecto a 170.

C) Datos del Exterior:
   - Agregar filas a results.presidencial (o results.presidencial_municipios si aplica)
   - Agregar circunscripciones exteriores en diputados y su tabla de escaños.
   - Validar que el presidencial nacional coincida con oficial.

========================
MEMORIA DE ENCUESTAS (LOCALSTORAGE)
========================

- El simulador guarda encuestas en el navegador con una lista:
  key: fp2028_poll_store_v1

- Eso significa que:
  ✅ Se mantienen aunque cierres el navegador
  ✅ No se pierden al refrescar
  ❌ No se sincronizan entre computadoras automáticamente

Para sincronizar entre equipos:
- opción 1: exportar/importar (se puede agregar botón en v1.1)
- opción 2: guardar data/polls_store.json en el repo y cargarlo al iniciar (recomendado)


NOTA OCLE / EXTERIOR / PENITENCIARIO:
- En los resultados por colegios, cod_prov > 32 corresponde a recintos especiales (países del exterior y/o PENITENCIARIO).
- El simulador integra estos códigos en Presidencial por provincia para que el nacional sea completo.


ENCUESTAS (EQUIPO)
- Archivo compartido: data/encuestas.json
- Campos simples: partido, candidato, margen_error, fecha, encuestadora
- Nota: para que la encuesta afecte el simulador, debe incluir pollCand, pollParty, pollWeights (ya lo pone el botón Guardar LOCAL). En v1.0.4 puedes copiar esa entrada al archivo del equipo.


ENCUESTA SIMPLE (v1.0.5)
- Llena FP/PRM/PLD/OTROS + candidato + partido + margen + fecha + encuestadora.
- 'Aplicar encuesta' activa el modo encuestas y usa esos 4 números.
- 'Guardar para equipo' descarga encuestas.json. Súbelo a GitHub en /data/encuestas.json.


ENCUESTAS (EQUIPO) v1.0.6
- Botón: 'Aplicar encuesta más reciente (Equipo)'
- Botón: 'Comparar 2 encuestas (Equipo)'
- Historial visible: Top 20 en Home.

ALIANZAS v1.0.6
- Comparador muestra un indicador simple Conviene/No conviene con un score.
