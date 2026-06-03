path = r'E:\ky-platform\frontend\src\pages\LearningCenter.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
checks = ['\u77e5\u8bc6\u70b9', '\u5b66\u4e60\u8d44\u6599', '\u641c\u7d22\u5b66\u4e60\u8d44\u6599', 'AI \u5b66\u4e60\u4e2d\u5fc3', '\u672a\u8fde\u63a5', '\u65b0\u5bf9\u8bdd', '\u751f\u6210\u9898\u76ee', '\u4e3e\u4e00\u53cd\u4e09', '\u6982\u5ff5\u8bb2\u89e3']
for c in checks:
    status = 'OK' if c in content else 'MISSING'
    print(f'{c}: {status}')
