#!/usr/bin/env python3
"""Builds index.html (standalone PWA) from app.html, and artifact.html (preview without sync/service worker)."""
src = open('app.html', encoding='utf-8').read()
i = src.index('<script>\n\'use strict\';')
head_part, app_script = src[:i], src[i:]
pre = ('<!doctype html>\n<html lang="ar" dir="rtl"><head><meta charset="utf-8">'
       '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
       '<meta name="theme-color" content="#12304d"><link rel="manifest" href="manifest.json">'
       '<link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-192.png">'
       '<style>[hidden]{display:none!important}body{margin:0}</style>\n')
libs = ('<script src="config.js"></script>\n'
        '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"></script>\n'
        '<script src="sync.js"></script>\n<script src="comm.js"></script>\n<script src="ext.js"></script>\n<script src="logs.js"></script>\n<script src="ledger.js"></script>\n<script src="booking.js"></script>\n')
reg = ("<script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){})})}</script>\n")
open('index.html', 'w', encoding='utf-8').write(pre + head_part + libs + app_script + reg + '</body></html>\n')
open('artifact.html', 'w', encoding='utf-8').write(src)
print('built index.html, artifact.html')
