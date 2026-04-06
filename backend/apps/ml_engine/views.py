from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import permissions, status, viewsets, filters
from django_filters.rest_framework import DjangoFilterBackend
from django.utils import timezone


# ── Model Registry ──────────────────────────────────────────────────
class ModelRegistryView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    def get(self, request):
        from apps.ml_engine.models import ModelRegistry
        data = list(ModelRegistry.objects.filter(is_active=True).values(
            "id","arch","display_name","description","default_hparams"))
        for d in data:
            d["id"] = str(d["id"])
        return Response(data)


# ── Experiment ViewSet ───────────────────────────────────────────────
class ExperimentViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    filter_backends    = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields   = ["status"]
    ordering_fields    = ["created_at"]
    ordering           = ["-created_at"]

    def get_queryset(self):
        from apps.ml_engine.models import Experiment
        return Experiment.objects.filter(user=self.request.user).prefetch_related("runs")

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        data = []
        for exp in qs:
            runs = []
            for r in exp.runs.all().order_by("-started_at")[:1]:
                runs.append({"id":str(r.id),"status":r.status,"epochs_done":r.epochs_done})
            data.append({
                "id":         str(exp.id),
                "name":       exp.name,
                "description":exp.description,
                "ticker":     exp.ticker,
                "benchmark":  exp.benchmark,
                "status":     exp.status,
                "feature_ids":exp.feature_ids,
                "runs":       runs,
                "created_at": exp.created_at,
                "updated_at": exp.updated_at,
            })
        return Response(data)

    def create(self, request, *args, **kwargs):
        from apps.ml_engine.models import Experiment
        d = request.data
        exp = Experiment.objects.create(
            user=request.user,
            name=d.get("name",""),
            description=d.get("description",""),
            ticker=d.get("ticker","2603.TW"),
            benchmark=d.get("benchmark","0050.TW"),
            date_start=d.get("date_start","2020-01-01"),
            date_end=d.get("date_end","2026-03-27"),
            feature_ids=d.get("feature_ids",[]),
        )
        return Response({"id":str(exp.id),"name":exp.name,"status":exp.status}, status=201)

    def partial_update(self, request, pk=None, *args, **kwargs):
        from apps.ml_engine.models import Experiment
        exp = Experiment.objects.get(id=pk, user=request.user)
        for field in (
            "name", "description", "ticker", "benchmark",
            "date_start", "date_end", "feature_ids", "status",
        ):
            if field in request.data:
                setattr(exp, field, request.data[field])
        exp.save()
        return Response({"id": str(exp.id)})

    def retrieve(self, request, pk=None, *args, **kwargs):
        from apps.ml_engine.models import Experiment
        exp = Experiment.objects.get(id=pk, user=request.user)
        runs = list(exp.runs.all().order_by("-started_at").values(
            "id","status","epochs_done","started_at","finished_at","model_arch__display_name"))
        for r in runs:
            r["id"] = str(r["id"])
            r["model_name"] = r.pop("model_arch__display_name")
        return Response({
            "id": str(exp.id),
            "name": exp.name,
            "description": exp.description,
            "ticker": exp.ticker,
            "benchmark": exp.benchmark,
            "date_start": exp.date_start,
            "date_end": exp.date_end,
            "status": exp.status,
            "feature_ids": exp.feature_ids,
            "created_at": exp.created_at,
            "updated_at": exp.updated_at,
            "runs": runs,
        })


# ── Launch Training ─────────────────────────────────────────────────
class LaunchTrainingView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, exp_id):
        from apps.ml_engine.models import Experiment, TrainingRun, ModelRegistry
        from apps.ml_engine.tasks import run_training

        exp      = Experiment.objects.get(id=exp_id, user=request.user)
        arch_id  = request.data.get("model_arch_id")
        hparams  = request.data.get("hparams", {})
        arch     = ModelRegistry.objects.get(id=arch_id)
        run      = TrainingRun.objects.create(experiment=exp, model_arch=arch, hparams=hparams)
        exp.status = "queued"; exp.save(update_fields=["status"])

        task = run_training.apply_async(args=[str(run.id)], queue="training")
        run.celery_task_id = task.id
        run.save(update_fields=["celery_task_id"])
        return Response({"run_id": str(run.id), "task_id": task.id}, status=202)


# ── Training Run Status ─────────────────────────────────────────────
class TrainingRunStatusView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, run_id):
        from apps.ml_engine.models import TrainingRun
        run = TrainingRun.objects.select_related("experiment", "model_arch").get(
            id=run_id, experiment__user=request.user)
        now = timezone.now()
        return Response({
            "id":           str(run.id),
            "status":       run.status,
            "epochs_done":  run.epochs_done,
            "loss_history": run.loss_history,
            "error_msg":    run.error_msg,
            "started_at":   run.started_at,
            "finished_at":  run.finished_at,
            "celery_task_id": run.celery_task_id,
            "hparams": run.hparams,
            "model_arch": {
                "id": str(run.model_arch_id),
                "display_name": run.model_arch.display_name,
                "arch": run.model_arch.arch,
            },
            "experiment": {
                "id": str(run.experiment_id),
                "status": run.experiment.status,
            },
            "server_time": now,
        })


# ── Backtest Result ─────────────────────────────────────────────────
class BacktestResultView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, run_id):
        from apps.ml_engine.models import TrainingRun, BacktestResult
        run = TrainingRun.objects.get(id=run_id, experiment__user=request.user)
        try:
            bt = BacktestResult.objects.get(run=run)
        except BacktestResult.DoesNotExist:
            return Response({"status": "not_ready"}, status=202)
        return Response({
            "metrics": {
                "total_return":   bt.total_return,
                "bh_return":      bt.bh_return,
                "annualized_ret": bt.annualized_ret,
                "sharpe_ratio":   bt.sharpe_ratio,
                "calmar_ratio":   bt.calmar_ratio,
                "max_drawdown":   bt.max_drawdown,
                "win_rate":       bt.win_rate,
                "turnover_rate":  bt.turnover_rate,
            },
            "equity_curve":   bt.equity_curve,
            "bh_curve":       bt.bh_curve,
            "drawdown_curve": bt.drawdown_curve,
            "position_log":   bt.position_log,
        })


# ── Prediction ──────────────────────────────────────────────────────
class PredictionView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, run_id):
        from apps.ml_engine.models import TrainingRun, PredictionRecord
        run  = TrainingRun.objects.get(id=run_id, experiment__user=request.user)
        pred = PredictionRecord.objects.filter(run=run).order_by("-prediction_date").first()
        if not pred:
            return Response({"error": "No prediction yet"}, status=404)
        return Response({
            "signal":          pred.signal,
            "prob_long":       pred.prob_long,
            "prob_short":      pred.prob_short,
            "prob_neutral":    pred.prob_neutral,
            "confidence":      pred.confidence,
            "rsi_14":          pred.rsi_14,
            "vol_ann":         pred.vol_ann,
            "excess_ret":      0.0,
            "stop_loss_pct":   pred.stop_loss_pct,
            "target_pct":      pred.target_pct,
            "prediction_date": str(pred.prediction_date),
            "target_date":     str(pred.target_date),
        })


# ── Health Check ────────────────────────────────────────────────────
class HealthCheckView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        from django.db import connections
        from django.core.cache import cache
        checks = {}
        try:
            connections["default"].cursor().execute("SELECT 1")
            checks["postgres"] = "ok"
        except Exception as e:
            checks["postgres"] = str(e)
        try:
            cache.set("hc", "1", 5); checks["redis"] = "ok"
        except Exception as e:
            checks["redis"] = str(e)
        code = 200 if all(v=="ok" for v in checks.values()) else 503
        return Response({"status":"ok" if code==200 else "degraded","checks":checks}, status=code)
