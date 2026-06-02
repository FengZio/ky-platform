import re
from typing import List, Tuple, Dict, Optional

# ─── Markdown 标题层级 ──────────────────────────────────
# (正则, chunk_type, 标题层级: 1=#  2=##  3=###  4=####)
_HEADER_PATTERNS: List[Tuple[re.Pattern, str, int]] = [
    (re.compile(r'\n(?=####\s*题\d+)'), 'question', 4),
    (re.compile(r'\n(?=####\s)'), 'question', 4),
    (re.compile(r'\n(?=【例題】|【例题】|【经典例题】|【题目】)'), 'question', 4),
    (re.compile(r'\n(?=###\s)'), 'knowledge', 3),
    (re.compile(r'\n(?=##\s)'), 'knowledge', 2),
    (re.compile(r'\n(?=\d+[\.\、\．\)）》]\s)'), 'question', 4),
]

# ─── 目录检测正则 ────────────────────────────────────
_TOC_PATTERNS = [
    re.compile(r'目\s*录|目次|CONTENTS', re.IGNORECASE),
    re.compile(r'^\s*(第[一二三四五六七八九十\d]+章|Chapter\s*\d+|第[一二三四五六七八九十\d]+节)', re.MULTILINE),
]
# 目录连续行特征: 多行带页码 (…42 / .42 / (42))
_TOC_LINE_RE = re.compile(r'[\.\．\s…]{3,}\s*\d{1,4}\s*[)）]?\s*$|\(\d{1,4}\)\s*$')
_TOC_MAX_LINE_LEN = 80
_TOC_MIN_CONSECUTIVE = 3  # 连续3行以上匹配才算目录区

# ─── 知识点标签映射 (关键词 → 标准名) ─────────────────
_KNOWLEDGE_TAGS: Dict[str, str] = {
    '单链表': '单链表', '双链表': '双链表', '循环链表': '循环链表', '链表': '链表',
    '栈': '栈', '队列': '队列',
    '二叉树': '二叉树', '二叉搜索树': '二叉搜索树', '平衡二叉树': '平衡二叉树',
    'AVL': '平衡二叉树', '红黑树': '红黑树', 'B树': 'B树与B+树', 'B+树': 'B树与B+树',
    '堆': '堆', '优先队列': '优先队列', '哈希表': '哈希表', '散列表': '哈希表',
    '图': '图', 'DFS': '深度优先搜索', 'BFS': '广度优先搜索',
    '深度优先': '深度优先搜索', '广度优先': '广度优先搜索',
    '排序': '排序', '快速排序': '快速排序', '归并排序': '归并排序',
    '堆排序': '堆排序', '冒泡排序': '冒泡排序',
    '动态规划': '动态规划', '贪心': '贪心算法', '递归': '递归',
    '分治': '分治法', '回溯': '回溯法',
    '极限': '极限与连续', '连续': '极限与连续', '导数': '导数与微分',
    '微分': '导数与微分', '积分': '积分学', '定积分': '积分学',
    '不定积分': '积分学', '多元函数': '多元函数微分学', '偏导数': '多元函数微分学',
    '全微分': '多元函数微分学', '级数': '无穷级数',
    '特征值': '特征值与特征向量', '特征向量': '特征值与特征向量',
    '行列式': '行列式', '矩阵': '矩阵',
    '选择题': '选择题型', '填空题': '填空题型', '计算题': '计算题型', '证明题': '证明题型',
    '快慢指针': '快慢指针', '反转链表': '反转链表',
}

# ─── 从标题文本提取知识点名 ────────────────────────────
def _heading_to_kp(heading_text: str) -> Optional[str]:
    """从 Markdown 标题中提取知识点名称.
    例: '## 1.2 线性表的链式存储' → '线性表的链式存储'
         '### 2.3.1 栈的基本概念' → '栈的基本概念'
    """
    # 去掉 ##/### 前缀、章节编号
    cleaned = re.sub(r'^#+\s*', '', heading_text)
    cleaned = re.sub(r'^[\d\.\s]+', '', cleaned)
    cleaned = cleaned.strip()
    # 过滤纯数字/纯标点/过短
    if len(cleaned) <= 1 or re.match(r'^[\d\.\-\s]+$', cleaned):
        return None
    # 过滤题目类标题（题N / Question N / 例N）
    if re.search(r'题\s*\d+|Question\s*\d+|Example\s*\d+', cleaned, re.IGNORECASE):
        return None
    # 过滤目录关键词
    if re.search(r'目\s*录|前言|参考文献|附录', cleaned):
        return None
    return cleaned


def _is_toc_region(lines: List[str], start_idx: int) -> bool:
    """检测从 start_idx 开始的连续行是否为目录区域."""
    consecutive = 0
    for i in range(start_idx, min(start_idx + 20, len(lines))):
        line = lines[i].strip()
        if not line:
            continue
        if len(line) < _TOC_MAX_LINE_LEN and _TOC_LINE_RE.search(line):
            consecutive += 1
            if consecutive >= _TOC_MIN_CONSECUTIVE:
                return True
        else:
            consecutive = 0
    return False


def _clean_formula_garbage(text: str) -> str:
    """清洗 PDF 公式产生的乱码字符."""
    import unicodedata
    result = []
    for ch in text:
        cp = ord(ch)
        if 0xE000 <= cp <= 0xF8FF:
            continue
        if unicodedata.category(ch) in ('Cc', 'Cf', 'Co', 'Cs') and ch not in '\n\r\t':
            continue
        result.append(ch)
    cleaned = ''.join(result)
    cleaned = re.sub(r'(?:##\s*){3,}', ' ', cleaned)
    cleaned = re.sub(r'#{5,}', '', cleaned)
    cleaned = re.sub(r'\s{3,}', '\n\n', cleaned)
    return cleaned.strip()


def _extract_knowledge_points(text: str, context_kps: Optional[List[str]] = None) -> List[str]:
    """提取知识点标签: 关键词匹配 + 上下文继承."""
    found: List[str] = []
    seen = set()

    # 1. 上下文继承的标签优先 (来自父级 ##/### 标题)
    if context_kps:
        for kp in context_kps:
            if kp not in seen:
                found.append(kp)
                seen.add(kp)

    # 2. 文本关键词匹配 (去重)
    for keyword, kp_name in _KNOWLEDGE_TAGS.items():
        if keyword in text and kp_name not in seen:
            found.append(kp_name)
            seen.add(kp_name)

    return found


def chunk_text(text: str, max_chars: int = 400) -> List[dict]:
    """按 Markdown 结构智能分块, 支持上下文继承和目录检测.

    Returns:
      [{content, chunk_type, knowledge_points}, ...]
      chunk_type: 'question' | 'knowledge' | 'toc' | 'unknown'
    """
    text = _clean_formula_garbage(text)
    if not text.strip():
        return [{'content': '(empty after formula cleanup)', 'chunk_type': 'question', 'knowledge_points': []}]

    work_text = '\n' + text
    lines = text.split('\n')

    # ── 第一步: 收集所有标题及其位置/文本 ──
    # 用于后续推导每个区域的「当前上下文」
    heading_boundaries: List[dict] = []  # {pos, level, text, kp_name}
    for i, line in enumerate(lines):
        stripped = line.strip()
        m = re.match(r'^(#{1,4})\s+(.+)', stripped)
        if m:
            level = len(m.group(1))
            heading_text = m.group(2)
            kp = _heading_to_kp(stripped)
            char_pos = sum(len(l) + 1 for l in lines[:i])  # 累加前面行的长度+换行符
            heading_boundaries.append({
                'pos': char_pos,
                'level': level,
                'text': heading_text,
                'kp_name': kp,
            })

    # ── 第二步: 收集所有切分点 (含标题和题目标记) ──
    boundaries = _find_boundaries(work_text)
    # 把 heading_boundaries 也加入 (使用 work_text 坐标)
    for hb in heading_boundaries:
        boundaries.append((hb['pos'] + 1, 'knowledge'))  # +1 因为 work_text 前缀 \n
    boundaries.sort(key=lambda x: x[0])
    # 去重 (相近位置)
    deduped = []
    for pos, ctype in boundaries:
        if not any(abs(pos - d[0]) < 5 for d in deduped):
            deduped.append((pos, ctype))
    boundaries = deduped

    if not boundaries:
        return [{'content': text.strip(), 'chunk_type': 'question',
                 'knowledge_points': _extract_knowledge_points(text)}]

    # ── 第三步: 构建每个边界点的上下文栈 (前一个 ## 标题) ──
    # 按字符位置给每个区域分配「当前所属的 ## 和 ### 标题列表」
    boundary_contexts: List[List[str]] = []
    current_h2 = None
    current_h3 = None
    current_h4 = None
    h_idx = 0
    for pos, ctype in boundaries:
        orig = pos - 1
        # 更新当前标题上下文
        while h_idx < len(heading_boundaries) and heading_boundaries[h_idx]['pos'] <= orig:
            hb = heading_boundaries[h_idx]
            if hb['level'] == 2:
                current_h2 = hb['kp_name']
                current_h3 = None
                current_h4 = None
            elif hb['level'] == 3:
                current_h3 = hb['kp_name']
                current_h4 = None
            elif hb['level'] == 4:
                current_h4 = hb['kp_name']
            h_idx += 1
        ctx = [k for k in (current_h2, current_h3, current_h4) if k]
        boundary_contexts.append(ctx)

    # ── 第四步: 切出片段 ──
    raw: List[Tuple[str, str, List[str]]] = []  # (content, chunk_type, context_kps)
    current_type = 'question'
    current_ctx: List[str] = []
    prev = 0
    prev_ctx_idx = -1

    for idx, (pos, ctype) in enumerate(boundaries):
        orig_pos = pos - 1
        ctx = boundary_contexts[idx] if idx < len(boundary_contexts) else []

        if orig_pos < 0:
            current_type = ctype
            current_ctx = ctx
            continue

        segment = text[prev:orig_pos].strip()
        if segment:
            # 使用上一个区间结束时的上下文
            actual_ctx = boundary_contexts[prev_ctx_idx] if prev_ctx_idx >= 0 else []
            raw.append((segment, current_type, actual_ctx))

        current_type = ctype
        current_ctx = ctx
        prev = orig_pos
        prev_ctx_idx = idx

    tail = text[prev:].strip()
    if tail:
        raw.append((tail, current_type, current_ctx))

    # ── 第五步: 合并短 chunk ──
    merged: List[Tuple[str, str, List[str]]] = []
    pending: Optional[Tuple[str, str, List[str]]] = None
    for content, ctype, ctx in raw:
        if len(content) < 30:
            if pending:
                pending = (pending[0] + '\n' + content, pending[1], pending[2])
            else:
                pending = (content, ctype, ctx)
        else:
            if pending:
                merged.append((pending[0] + '\n' + content, pending[1], pending[2]))
                pending = None
            else:
                merged.append((content, ctype, ctx))
    if pending:
        if merged:
            merged[-1] = (merged[-1][0] + '\n' + pending[0], merged[-1][1], merged[-1][2])
        else:
            merged.append(pending)

    # ── 第六步: 二次切分超长 + 目录检测 ──
    result: List[dict] = []
    toc_active = False
    for content, ctype, ctx in merged:
        # 目录检测: 检查前几行
        content_lines = content.split('\n')
        is_toc = False
        if not toc_active:
            is_toc = _is_toc_region(content_lines, 0)
            if is_toc:
                toc_active = True
        if toc_active:
            # 目录区连续检测: 继续检查
            is_toc = _is_toc_region(content_lines, 0)
            if not is_toc:
                toc_active = False

        final_type = 'toc' if is_toc else ctype

        if len(content) <= max_chars:
            result.append({
                'content': content,
                'chunk_type': final_type,
                'knowledge_points': _extract_knowledge_points(content, ctx),
            })
        else:
            paragraphs = content.split('\n\n')
            current = ''
            for para in paragraphs:
                p = para.strip()
                if not p:
                    continue
                if len(current) + len(p) > max_chars and current:
                    result.append({
                        'content': current.strip(),
                        'chunk_type': final_type,
                        'knowledge_points': _extract_knowledge_points(current, ctx),
                    })
                    current = p
                else:
                    current += ('\n\n' if current else '') + p
                while len(current) > max_chars * 2:
                    split_at = current.rfind('。', 0, max_chars)
                    if split_at > 0:
                        result.append({
                            'content': current[:split_at + 1].strip(),
                            'chunk_type': final_type,
                            'knowledge_points': _extract_knowledge_points(current[:split_at + 1], ctx),
                        })
                        current = current[split_at + 1:].strip()
                    else:
                        result.append({
                            'content': current[:max_chars].strip(),
                            'chunk_type': final_type,
                            'knowledge_points': _extract_knowledge_points(current[:max_chars], ctx),
                        })
                        current = current[max_chars:].strip()
            if current.strip():
                result.append({
                    'content': current.strip(),
                    'chunk_type': final_type,
                    'knowledge_points': _extract_knowledge_points(current, ctx),
                })

    return result


def _find_boundaries(text: str) -> List[Tuple[int, str]]:
    """找所有分割点位置及其 chunk_type."""
    boundaries: List[Tuple[int, str]] = []
    for pattern, ctype, _level in _HEADER_PATTERNS:
        for m in pattern.finditer(text):
            pos = m.end()
            if not any(abs(pos - b[0]) < 5 for b in boundaries):
                boundaries.append((pos, ctype))
    boundaries.sort(key=lambda x: x[0])
    return boundaries


# 向后兼容
def chunk_text_simple(text: str, max_chars: int = 400) -> List[str]:
    return [c['content'] for c in chunk_text(text, max_chars)]
