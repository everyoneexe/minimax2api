#!/bin/bash
# 15 dakikada 10 hesap ekle

echo "=== Gmail ile Toplu Kayıt ==="
echo ""
echo "1. Chrome'da https://account.minimax.io/unified-login aç"
echo "2. 10 farklı Gmail hesabı aç (varsa) veya yeni oluştur"
echo "3. Her biriyle MiniMax'e kayıt yap"
echo ""
echo "Alternatif: Outlook/Proton/FastMail gibi gerçek servisler"
echo ""
echo "VEYA otomatik Gmail hesap oluşturucu kullan:"
echo "  - https://github.com/topics/gmail-account-creator"
echo "  - Puppeteer ile Gmail kayıt + MiniMax kayıt pipeline'ı"
echo ""
echo "Manuel kayıttan sonra hesapları config.json'a ekle:"
echo ""
cat << 'PYTHON'
import json
config = json.load(open('minimax2api/config.json'))
config['accounts'].extend([
    {'name': 'g1', 'email': 'user1@gmail.com', 'password': 'pass1', 'auth_mode': 'token', 'base_url': 'https://agent.minimax.io', 'is_active': True, 'depleted': False},
    # ... 9 tane daha
])
config['account_pool_target'] = len([a for a in config['accounts'] if a['is_active']])
json.dump(config, open('minimax2api/config.json', 'w'), indent=2)
PYTHON
