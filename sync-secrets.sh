#!/bin/bash

# Configuración
PROJECT_NAME="bitmeet"
ENV_FILE=".env"

# Comprobar si existe el archivo .env
if [ ! -f "$ENV_FILE" ]; then
    echo "Error: El archivo $ENV_FILE no existe."
    exit 1
fi

echo "🚀 Iniciando subida de secretos para el proyecto: $PROJECT_NAME"

# Leer el archivo .env línea por línea
while IFS= read -r line || [ -n "$line" ]; do
    # Ignorar líneas vacías y comentarios
    [[ -z "$line" || "$line" =~ ^# ]] && continue

    # Extraer clave y valor (soporta valores con el signo =)
    KEY=$(echo "$line" | cut -d '=' -f 1)
    VALUE=$(echo "$line" | cut -d '=' -f 2-)

    # Limpiar posibles comillas en el valor
    VALUE=$(echo "$VALUE" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")

    if [ -n "$KEY" ]; then
        echo "📤 Subiendo: $KEY..."
        # Usamos printf para evitar problemas con caracteres especiales y lo pasamos por stdin a wrangler
        printf "%s" "$VALUE" | npx wrangler pages secret put "$KEY" --project-name "$PROJECT_NAME"
        
        if [ $? -eq 0 ]; then
            echo "✅ $KEY subido correctamente."
        else
            echo "❌ Error al subir $KEY."
        fi
    fi
done < "$ENV_FILE"

echo "✨ Proceso finalizado."
