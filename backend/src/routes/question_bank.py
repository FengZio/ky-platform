"""Resources Question Routes --- 资源库题库 CRUD + AI 提取 + PDF 导出 + 加入计划"""

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, Field

from src.services.supabase import get_admin
import re as _re

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/resources/questions", tags=["resources_questions"])

# ============================================================
# Pydantic Models
# ============================================================

class QuestionCreate(BaseModel):
    type: str = Field(..., pattern="^(choice|short_answer|calculation|essay|true_false)$")
    difficulty: int = Field(default=3, ge=1, le=5)
    content: str
    options: list = Field(default_factory=list)
    answer: str
    explanation: Optional[str] = None
    knowledge_point_ids: list[str] = Field(default_factory=list)
    material_id: Optional[str] = None
    plan_id: Optional[str] = None
    phase_id: Optional[str] = None
    source_conversation_id: Optional[str] = None
    tags: list[str] = Field(default_factory=list)

class ExtractRequest(BaseModel):
    markdown: str
    conversation_id: Optional[str] = None
    knowledge_point_ids: list[str] = Field(default_factory=list)

class ToPlanRequest(BaseModel):
    question_id: str
    plan_id: str
    phase_id: Optional[str] = None


TYPE_LABELS = {
    "choice": "选择题",
    "short_answer": "简答题",
    "calculation": "计算题",
    "essay": "论述题",
    "true_false": "判断题",
}

# ============================================================
# Helpers
# ============================================================

def _content_hash(content: str, answer: str) -> str:
    return hashlib.sha256((content + answer).encode("utf-8")).hexdigest()

def _safe_supabase(res):
    """兼容 supabase-py v2 (APIResponse) 和 v3"""
    return res.data if hasattr(res, "data") else res

async def _get_chat_ai_config() -> dict:
    """获取用于题目提取的 LLM 配置 (ai_configs 表 > .env 全局默认)"""
    from src.config import settings

    res = get_admin().table("ai_configs").select("*").eq("is_active", True).limit(1).execute()
    data = _safe_supabase(res)
    cfg = (data[0] if isinstance(data, list) and data else data) or {}
    return {
        "api_key": cfg.get("api_key") or settings.openai_api_key,
        "base_url": cfg.get("base_url") or settings.openai_base_url,
        "chat_model": cfg.get("chat_model") or "gpt-4o-mini",
    }

# ============================================================
# CRUD
# ============================================================

@router.post("")
async def create_question(req: Request, body: QuestionCreate):
    """保存单道题目到题库"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    content_hash = _content_hash(body.content, body.answer)
    payload = {
        "user_id": user,
        "content_hash": content_hash,
        "type": body.type,
        "difficulty": body.difficulty,
        "content": body.content,
        "options": json.dumps(body.options),
        "answer": body.answer,
        "explanation": body.explanation,
        "knowledge_point_ids": body.knowledge_point_ids,
        "material_id": body.material_id,
        "plan_id": body.plan_id,
        "phase_id": body.phase_id,
        "source": "ai_generated" if body.source_conversation_id else "manual",
        "source_conversation_id": body.source_conversation_id,
        "tags": body.tags,
    }

    try:
        res = get_admin().table("question_bank").upsert(
            payload, on_conflict="user_id,content_hash"
        ).execute()
        data = _safe_supabase(res)
        item = data[0] if isinstance(data, list) else data
        return {"status": "ok", "question": item}
    except Exception as e:
        logger.error(f"Create question error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("")
async def list_questions(
    req: Request,
    type: str = Query(default=""),
    difficulty: int = Query(default=0, ge=0, le=5),
    knowledge_point_id: str = Query(default=""),
    source: str = Query(default=""),
    plan_id: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """分页查询题库"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    q = get_admin().table("question_bank").select("*", count="exact").eq("user_id", user)

    if type:
        q = q.eq("type", type)
    if difficulty > 0:
        q = q.eq("difficulty", difficulty)
    if source:
        q = q.eq("source", source)
    if plan_id:
        q = q.eq("plan_id", plan_id)

    q = q.order("created_at", desc=True).range(offset, offset + limit - 1)
    res = q.execute()
    data = _safe_supabase(res)
    count = res.count if hasattr(res, "count") else len(data) if isinstance(data, list) else 0

    items = data if isinstance(data, list) else []
    if knowledge_point_id and items:
        items = [i for i in items if knowledge_point_id in (i.get("knowledge_point_ids") or [])]
        count = len(items)

    return {"questions": items, "total": count, "limit": limit, "offset": offset}

@router.delete("/{question_id}")
async def delete_question(req: Request, question_id: str):
    """删除题目"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    res = get_admin().table("question_bank").delete().eq("id", question_id).eq("user_id", user).execute()
    data = _safe_supabase(res)
    if not data:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"status": "deleted"}

# ============================================================
# AI 提取题目 (json_object 回退)
# ============================================================


def _repair_json_strings(text):
    """修复 JSON 字符串中的常见问题：未转义的反斜杠、未终止的字符串等"""
    # 修复未转义的反斜杠（在 JSON 字符串内 \d, \f 等应为 \\d, \\f）
    text = _re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', text)
    return text


def _repair_llm_json(text):
    """Fix common LLM JSON output issues"""
    # 1. Remove illegal control characters
    text = _re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    # 2. Fix unescaped backslashes
    text = _repair_json_strings(text)
    # 3. Fix unterminated strings
    fixed_lines = []
    for line in text.split("\n"):
        s = line.rstrip()
        if s and s.count(chr(34)) % 2 != 0:
            if not s.endswith(chr(34)):
                s = s + chr(34)
        fixed_lines.append(s)
    text = "\n".join(fixed_lines)
    # 4. Balance brackets
    if not text.rstrip().endswith("}"):
        ob = text.count("{") - text.count("}")
        obr = text.count("[") - text.count("]")
        text = text.rstrip() + "]" * max(0, obr) + "}" * max(0, ob)
    return text
QUESTION_SCHEMA = {"type": "json_object"}

EXTRACT_PROMPT = """你是一个考研题库结构化提取器。请从以下 AI 对话回复中提取所有题目，输出一个纯净的 JSON 对象。

输出格式必须严格如下（不要包含任何其他文字、注释或 Markdown 标记）：
{{"questions":[{{"type":"choice","difficulty":3,"content":"题目内容（保留 $$ 和 $ 公式）","options":[{{"label":"A","text":"选项A"}}],"answer":"正确答案","explanation":"解析"}}]}}

规则：
1. type 取值为: choice、short_answer、calculation、essay、true_false
2. difficulty 取 1-5 的整数
3. 保留所有 LaTeX 公式（$$...$$ 或 $...$），原样放入 JSON 字符串中不要修改
4. 若不是选择题，options 用空数组 []
5. 只输出纯净 JSON，不要输出 ```json 或其他包装

待提取的对话回复：
---
{markdown}
---"""

@router.post("/extract")
async def extract_questions(req: Request, body: ExtractRequest):
    """从对话 Markdown 用 LLM 提取结构化题目"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not body.markdown.strip():
        raise HTTPException(status_code=400, detail="Markdown content is empty")

    cfg = await _get_chat_ai_config()
    if not cfg["api_key"]:
        raise HTTPException(status_code=500, detail="No AI config found")

    prompt = EXTRACT_PROMPT.format(markdown=body.markdown)

    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(
            f"{cfg['base_url'].rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {cfg['api_key']}",
                "Content-Type": "application/json",
            },
            json={
                "model": cfg["chat_model"],
                "messages": [{"role": "user", "content": prompt}],
                "response_format": QUESTION_SCHEMA,
                "max_tokens": 8192,
                "temperature": 0.1,
            },
        )

    if resp.status_code != 200:
        logger.error(f"LLM extract failed: {resp.status_code} {resp.text[:500]}")
        raise HTTPException(status_code=502, detail=f"LLM API error: {resp.status_code}")

    result = resp.json()
    choices = result.get("choices", [])
    if not choices:
        raise HTTPException(status_code=502, detail="LLM returned no choices")

    content_raw = choices[0].get("message", {}).get("content", "{}")

    # 清理 LLM 输出：去除可能的 markdown 代码块标记和尾部逗号
    content_clean = content_raw.strip()
    if content_clean.startswith("```"):
        # 去掉 ```json 和结尾 ```
        content_clean = content_clean.split("\n", 1)[-1] if "\n" in content_clean else content_clean[7:]
        if content_clean.endswith("```"):
            content_clean = content_clean[:-3]
        content_clean = content_clean.strip()

    # 修复 LLM 输出中常见的 JSON 格式问题（未终止字符串、缺失括号等）
    content_clean = _repair_llm_json(content_clean)

    parsed = None
    try:
        parsed = json.loads(content_clean)
    except json.JSONDecodeError:
        # Try fixing trailing commas
        try:
            fixed = _re.sub(r',\s*([}\]])', r'\1', content_clean)
            parsed = json.loads(fixed)
            logger.info("LLM JSON parsed after trailing comma fix")
        except json.JSONDecodeError as e:
            pass  # fall through to regex fallback

    if parsed is None:
        # Fallback: regex extract questions array
        logger.warning("LLM JSON parse error, trying regex fallback")
        match = _re.search(r'"questions"\s*:\s*(\[[\s\S]*?\])(?=\s*\})', content_raw)
        if not match:
            match = _re.search(r'"questions"\s*:\s*(\[.*)', content_raw, _re.DOTALL)
        if match:
            try:
                questions_raw = match.group(1)
                questions_raw = _repair_json_strings(questions_raw)
                parsed = {"questions": json.loads(questions_raw)}
            except Exception as ex2:
                logger.error(f"Fallback parse also failed: {ex2}")
                logger.error(f"Raw content (first 1000 chars): {content_raw[:1000]}")
                return {"status": "error", "message": f"Unable to parse AI output: {str(ex2)[:200]}", "questions": []}
        else:
            logger.error(f"No questions array found in LLM output. Raw: {content_raw[:500]}")
            return {"status": "error", "message": "No question format detected in AI response", "questions": []}

    questions = parsed.get("questions", [])

    # 自动入库
    saved = []
    for q in questions:
        content_hash = _content_hash(q["content"], q.get("answer", ""))
        payload = {
            "user_id": user,
            "content_hash": content_hash,
            "type": q["type"],
            "difficulty": q.get("difficulty", 3),
            "content": q["content"],
            "options": json.dumps(q.get("options", [])),
            "answer": q.get("answer", ""),
            "explanation": q.get("explanation"),
            "knowledge_point_ids": body.knowledge_point_ids,
            "source": "ai_generated",
            "source_conversation_id": body.conversation_id,
        }
        try:
            res = get_admin().table("question_bank").upsert(
                payload, on_conflict="user_id,content_hash"
            ).execute()
            data = _safe_supabase(res)
            item = data[0] if isinstance(data, list) else data
            saved.append(item)
        except Exception as e:
            logger.warning(f"Save extracted question failed: {e}")

    return {"status": "ok", "extracted": len(questions), "saved": len(saved), "questions": saved}

# ============================================================
# 加入计划
# ============================================================

@router.post("/to-plan")
async def add_to_plan(req: Request, body: ToPlanRequest):
    """将题目添加到计划 -> 创建 DailyGoalItem"""
    user = getattr(req.state, "user_id", None)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    res = get_admin().table("question_bank").select("*").eq("id", body.question_id).eq("user_id", user).single().execute()
    q = _safe_supabase(res)
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    phase_id = body.phase_id
    if not phase_id:
        phase_res = get_admin().table("plan_phases").select("id").eq("plan_id", body.plan_id).eq("status", "active").order("sequence").limit(1).execute()
        phase_data = _safe_supabase(phase_res)
        if phase_data and isinstance(phase_data, list) and phase_data:
            phase_id = phase_data[0]["id"]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    goal_res = get_admin().table("daily_goals").select("id").eq("user_id", user).eq("date", today).single().execute()
    goal = _safe_supabase(goal_res)

    if not goal:
        goal_insert = get_admin().table("daily_goals").insert({"user_id": user, "date": today}).execute()
        goal_data = _safe_supabase(goal_insert)
        goal_id = (goal_data[0] if isinstance(goal_data, list) else goal_data)["id"]
    else:
        goal_id = goal["id"]

    kp_ids = q.get("knowledge_point_ids") or []
    item_payload = {
        "daily_goal_id": goal_id,
        "question_id": body.question_id,
        "knowledge_point_id": kp_ids[0] if kp_ids else None,
        "material_id": q.get("material_id"),
        "title": f"[{TYPE_LABELS.get(q.get('type',''), q.get('type',''))}] {q.get('content','')[:60]}",
        "description": q.get("content", "")[:200],
        "estimated_minutes": 15 + q.get("difficulty", 3) * 5,
        "status": "pending",
    }

    insert_res = get_admin().table("daily_goal_items").insert(item_payload).execute()
    item = _safe_supabase(insert_res)
    item_data = item[0] if isinstance(item, list) else item

    update_payload = {"plan_id": body.plan_id}
    if phase_id:
        update_payload["phase_id"] = phase_id
    get_admin().table("question_bank").update(update_payload).eq("id", body.question_id).execute()

    return {"status": "ok", "daily_goal_item": item_data, "daily_goal_id": goal_id}
