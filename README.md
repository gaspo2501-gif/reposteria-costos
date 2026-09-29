# Costos Repostería

App para calcular el precio de venta de tortas en base a costos (ingredientes por
gramo, mano de obra, gastos fijos, empaque) y margen de ganancia, y para llevar
el registro de pedidos entregados/cobrados.

## Configuración (una sola vez)

1. Editá `firebase-config.js` y pegá ahí el `firebaseConfig` que te dio Firebase
   al registrar la app web.
2. En Firebase Console → Firestore Database → pestaña **Reglas**, pegá esto y
   publicá:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```

   Esto permite leer/escribir solo a quien haya iniciado sesión anónima desde
   esta app (se hace sola, sin pedirte usuario ni contraseña).

3. En Firebase Console → Authentication → Sign-in method, activá el proveedor
   **Anónimo** si todavía no lo hiciste.

## Publicar en GitHub Pages

1. Subí todos los archivos de esta carpeta a la raíz de tu repositorio de
   GitHub (podés arrastrarlos desde la web de GitHub, sin usar la terminal).
2. En el repositorio: Settings → Pages → Build and deployment → Source:
   "Deploy from a branch" → Branch: `main` / carpeta `/ (root)` → Save.
3. En un par de minutos, GitHub te va a dar una URL tipo
   `https://tu-usuario.github.io/tu-repositorio/` — esa es tu app, ya
   funcionando desde el celular y desde la PC, con los datos sincronizados.

## Estructura

- `index.html` — estructura de la página.
- `style.css` — estilos (con modo claro/oscuro automático).
- `firebase-config.js` — tus credenciales de Firebase (no son secretas, son
  claves públicas de cliente; lo que protege tus datos son las reglas de
  Firestore del paso anterior).
- `app.js` — toda la lógica: ingredientes, recetas, cálculo de costos,
  pedidos e informe.

## Actualizar la app en el futuro

Cualquier cambio que quieras hacer (nuevas funciones, ajustes) lo vamos a ir
charlando acá; yo te voy a ir dando los archivos actualizados para que
reemplaces en el repositorio.
