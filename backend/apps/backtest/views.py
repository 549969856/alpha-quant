"""
apps/backtest/views.py
Extended backtest analytics API endpoints.
"""
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import permissions, status


class WalkForwardView(APIView):
    """
    GET  /api/runs/{run_id}/walk-forward/   — fetch results
    POST /api/runs/{run_id}/walk-forward/   — trigger computation
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, run_id):
        from apps.ml_engine.models import TrainingRun
        from apps.backtest.models import WalkForwardResult
        run = TrainingRun.objects.get(id=run_id, experiment__user=request.user)
        qs  = WalkForwardResult.objects.filter(run=run).order_by("window_idx")
        data = list(qs.values(
            "window_idx","train_start","train_end","test_start","test_end",
            "is_total_return","is_sharpe",
            "oos_total_return","oos_sharpe","oos_max_drawdown","oos_win_rate",
            "equity_curve",
        ))
        if not data:
            return Response({"status": "not_computed"}, status=202)
        return Response({"windows": data})

    def post(self, request, run_id):
        from apps.ml_engine.models import TrainingRun
        from apps.backtest.tasks import run_walk_forward
        run = TrainingRun.objects.get(id=run_id, experiment__user=request.user)
        if run.status != "done":
            return Response({"error": "Run not done yet"}, status=400)
        n_splits = int(request.data.get("n_splits", 5))
        task = run_walk_forward.apply_async(args=[str(run_id), n_splits])
        return Response({"task_id": task.id, "n_splits": n_splits}, status=202)


class MonteCarloView(APIView):
    """
    GET  /api/runs/{run_id}/monte-carlo/
    POST /api/runs/{run_id}/monte-carlo/
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, run_id):
        from apps.ml_engine.models import TrainingRun
        from apps.backtest.models import MonteCarloResult
        run = TrainingRun.objects.get(id=run_id, experiment__user=request.user)
        try:
            mc = MonteCarloResult.objects.get(run=run)
        except MonteCarloResult.DoesNotExist:
            return Response({"status": "not_computed"}, status=202)
        return Response({
            "n_simulations":   mc.n_simulations,
            "sim_mean_return": mc.sim_mean_return,
            "sim_std_return":  mc.sim_std_return,
            "sim_p5_return":   mc.sim_p5_return,
            "sim_p95_return":  mc.sim_p95_return,
            "actual_return":   mc.actual_return,
            "percentile_rank": mc.percentile_rank,
            "p_value":         mc.p_value,
            "histogram_bins":  mc.histogram_bins,
        })

    def post(self, request, run_id):
        from apps.ml_engine.models import TrainingRun
        from apps.backtest.tasks import run_monte_carlo
        run = TrainingRun.objects.get(id=run_id, experiment__user=request.user)
        if run.status != "done":
            return Response({"error": "Run not done yet"}, status=400)
        n = int(request.data.get("n_simulations", 1000))
        task = run_monte_carlo.apply_async(args=[str(run_id), n])
        return Response({"task_id": task.id, "n_simulations": n}, status=202)


class ComparisonView(APIView):
    """GET /api/experiments/{exp_id}/compare/  — leaderboard of all runs"""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, exp_id):
        from apps.ml_engine.models import Experiment, TrainingRun, BacktestResult
        from apps.backtest.analytics import build_comparison_table

        exp  = Experiment.objects.get(id=exp_id, user=request.user)
        runs = TrainingRun.objects.filter(
            experiment=exp, status="done"
        ).select_related("model_arch").prefetch_related("backtest")

        rows = []
        for run in runs:
            try:
                bt = run.backtest
                feat_count = len(exp.feature_ids)
                rows.append({
                    "run_id": str(run.id),
                    "label":  f"{run.model_arch.display_name} | {feat_count} 特徵",
                    "metrics": {
                        "total_return":   bt.total_return,
                        "annualized_ret": bt.annualized_ret,
                        "sharpe_ratio":   bt.sharpe_ratio,
                        "calmar_ratio":   bt.calmar_ratio,
                        "max_drawdown":   bt.max_drawdown,
                        "win_rate":       bt.win_rate,
                        "turnover_rate":  bt.turnover_rate,
                    },
                })
            except Exception:
                continue

        table = build_comparison_table(rows)
        return Response({"runs": table})
