"""Generator (account registration) routes."""
import threading
import time
import uuid

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from routes.state import _REGISTER_SCRIPT, _generator_jobs, GeneratorJob, _run_generator

router = APIRouter()

_JOB_TTL = 3600  # purge completed jobs after 1 hour


def _purge_old_jobs():
    now = time.time()
    stale = []
    for jid, j in list(_generator_jobs.items()):
        if not j.done:
            continue
        last_ts = max((log.get("ts", 0) / 1000 for log in j.logs), default=None)
        # Fall back to job creation time if no logs exist
        age_ref = last_ts if last_ts is not None else j.created_at
        if now - age_ref > _JOB_TTL:
            stale.append(jid)
    for jid in stale:
        _generator_jobs.pop(jid, None)


class GenerateRequest(BaseModel):
    count: int = 1
    parallel: bool = False
    parallel_count: int = 0


@router.post("/api/accounts/generate")
async def start_generate(req: GenerateRequest):
    if not _REGISTER_SCRIPT.exists():
        return JSONResponse({"detail": "register.js bulunamadı"}, status_code=404)
    _purge_old_jobs()
    count = max(1, min(50, req.count))
    if count != req.count:
        pass  # silently clamped — caller can inspect job for actual count
    job_id = str(uuid.uuid4())
    job = GeneratorJob(job_id, count, parallel=req.parallel)
    t = threading.Thread(target=_run_generator, args=(job,), daemon=True)
    job._thread = t
    _generator_jobs[job_id] = job
    t.start()
    return JSONResponse({"job_id": job_id, "count": count})


@router.get("/api/accounts/generate/{job_id}")
async def get_generate_status(job_id: str):
    job = _generator_jobs.get(job_id)
    if not job:
        return JSONResponse({"detail": "Job not found"}, status_code=404)
    return JSONResponse(job.to_dict())


@router.post("/api/accounts/generate/{job_id}/cancel")
async def cancel_generate(job_id: str):
    job = _generator_jobs.get(job_id)
    if not job:
        return JSONResponse({"detail": "Job not found"}, status_code=404)
    job.cancelled = True
    return JSONResponse({"status": "cancelling"})
