#!/bin/bash
# Run once to set up everything
# Usage: bash install.sh

set -e

VENV_DIR="$HOME/argos_test/trans-tts-env"
MODELS_DIR="$HOME/argos_test/models"
PIPER_DIR="$MODELS_DIR/piper"
ARGOS_DIR="$MODELS_DIR/argos"

echo "=== Creating virtual environment ==="
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"

echo "=== Installing packages (PyPI only, skipping piwheels for stability) ==="
pip install --upgrade pip --index-url https://pypi.org/simple/

pip install \
    argostranslate \
    piper-tts \
    fastapi \
    "uvicorn[standard]" \
    soundfile \
    numpy \
    --index-url https://pypi.org/simple/ \
    --no-cache-dir

echo "=== Creating model directories ==="
mkdir -p "$PIPER_DIR" "$ARGOS_DIR"

echo "=== Downloading Argos Translate language packages ==="
python3 - <<'PYEOF'
import argostranslate.package
import argostranslate.translate

print("Updating Argos package index...")
argostranslate.package.update_package_index()

available = argostranslate.package.get_available_packages()

# Languages to install: add or remove as needed
TARGET_LANGS = ["hi", "bn", "gu", "mr"]  # Hindi, Bengali, Gujarati, Marathi
# Note: Argos supports limited Indian languages — hi/bn/gu/mr are the main ones

installed = 0
for pkg in available:
    if pkg.from_code == "en" and pkg.to_code in TARGET_LANGS:
        print(f"Downloading en→{pkg.to_code} ({pkg.from_name}→{pkg.to_name})...")
        download_path = pkg.download()
        argostranslate.package.install_from_path(download_path)
        print(f"  ✓ Installed en→{pkg.to_code}")
        installed += 1

if installed == 0:
    print("WARNING: No packages installed — check your internet connection")
else:
    print(f"\nInstalled {installed} language package(s)")

# Verify
print("\nVerifying installed languages:")
for lang in argostranslate.translate.get_installed_languages():
    print(f"  {lang.code}: {lang.name}")
PYEOF

echo ""
echo "=== Downloading Piper TTS voices ==="
# Available Indian language voices on piper-voices
# hi_IN = Hindi, kn_IN = Kannada (limited availability — we use hi as primary)

BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"

download_voice() {
    local lang_path=$1
    local filename=$2
    local dest="$PIPER_DIR/$filename"
    if [ ! -f "$dest" ]; then
        echo "Downloading $filename..."
        wget -q --show-progress -O "$dest" "$BASE_URL/$lang_path/$filename" || \
            echo "  WARNING: Could not download $filename"
    else
        echo "  Already exists: $filename"
    fi
}

# Hindi voices
download_voice "hi/hi_IN/medium" "hi_IN-medium.onnx"
download_voice "hi/hi_IN/medium" "hi_IN-medium.onnx.json"

# Bengali (if available)
download_voice "bn/bn_IN/medium" "bn_IN-medium.onnx"      2>/dev/null || true
download_voice "bn/bn_IN/medium" "bn_IN-medium.onnx.json" 2>/dev/null || true

echo ""
echo "=== Listing downloaded Piper voices ==="
ls -lh "$PIPER_DIR/"

echo ""
echo "=== Quick translation test ==="
python3 - <<'PYEOF'
import argostranslate.translate as at

langs = at.get_installed_languages()
en_lang = next((l for l in langs if l.code == "en"), None)
if not en_lang:
    print("ERROR: English not found in installed languages")
    exit(1)

test_text = "Good morning, how are you?"
for lang in langs:
    if lang.code == "en":
        continue
    translation = en_lang.get_translation(lang)
    if translation:
        result = translation.translate(test_text)
        print(f"  en→{lang.code}: {result}")
PYEOF

echo ""
echo "=== Installation complete ==="
echo "  Venv:   $VENV_DIR"
echo "  Models: $MODELS_DIR"
echo ""
echo "  Start server:   source $VENV_DIR/bin/activate && python3 ~/trans_tts_server.py"
echo "  Enable service: sudo systemctl enable trans-tts && sudo systemctl start trans-tts"
