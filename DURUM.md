# MiniMax Kayıt Durumu (13 Haziran 2026)

## Sorun
MiniMax tüm geçici email servislerini engelliyor:
- guerrillamail.com ✗
- guerrillamailblock.com ✗  
- tempmail.plus ✗
- 1secmail.com ✗
- dropmail.me ✗
- disbox.net ✗
- mailto.plus ✗

## Mevcut Durum
- **4 aktif hesap** çalışıyor
- `account_pool_target` 4'e ayarlandı
- Lazy server 20 tab pool ile çalışıyor
- Sistem normal çalışıyor

## Yeni Hesap Eklemek İçin

### Seçenek 1: Manuel Kayıt (5 dakika)
1. https://account.minimax.io/unified-login aç
2. Gmail/Outlook ile kayıt yap
3. `generator/MANUEL_KAYIT.sh` dosyasındaki talimatları takip et

### Seçenek 2: OAuth (10-20 hesap için)
```bash
cd generator
node register_oauth.js google 10
# Her hesap için tarayıcıda Google ile giriş yaparsın
```

### Seçenek 3: Bekle
MiniMax'in kısıtlamaları gevşetmesini bekle

## register.js Neden Çalışmıyor
HAR'da 13 Haziran 00:32'de `@guerrillamail.com` başarılı
13 Haziran 01:56'da aynı domain başarısız

MiniMax **1.5 saat içinde** domain'i engellemeye aldı.
