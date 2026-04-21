#!/bin/bash

# Cores para o terminal
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}--- INICIANDO PROCESSO DE RELEASE ---${NC}"

# 1. Build do Frontend (Vite)
echo -e "${BLUE}1. Gerando build do React...${NC}"
cd client
npm run build

if [ $? -ne 0 ]; then
    echo "Erro no build do React. Abortando."
    exit 1
fi

# 2. Sync Capacitor
echo -e "${BLUE}2. Sincronizando com Android...${NC}"
npx cap sync android

# 3. Compilar APK (Assemble Release)
echo -e "${BLUE}3. Compilando APK de Produção...${NC}"
cd android
./gradlew assembleRelease

if [ $? -ne 0 ]; then
    echo "Erro na compilação do Android. Verifique o Java/Android Studio."
    exit 1
fi

# 4. Mover APK para a pasta dist
echo -e "${BLUE}4. Movendo APK para client/dist/app.apk...${NC}"
cd ../.. # Volta para a raiz
cp client/android/app/build/outputs/apk/release/app-release-unsigned.apk client/dist/app.apk 2>/dev/null || \
cp client/android/app/release/app-release.apk client/dist/app.apk 2>/dev/null || \
cp client/android/app/build/outputs/apk/release/app-release.apk client/dist/app.apk

echo -e "${GREEN}--- RELEASE CONCLUÍDA COM SUCESSO! ---${NC}"
echo -e "${GREEN}O novo APK está em: client/dist/app.apk${NC}"
echo -e "${BLUE}Agora você pode fazer o git push para atualizar o download no site.${NC}"
