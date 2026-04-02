from rest_framework import viewsets, permissions
from rest_framework.views import APIView
from rest_framework.response import Response


class FeatureDefinitionViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        from apps.market_data.models import FeatureDefinition
        qs = FeatureDefinition.objects.filter(is_active=True)
        categories = {}
        for f in qs.values("id","name","display_name","category","description","params"):
            cat = f.pop("category")
            f["id"] = str(f["id"])
            categories.setdefault(cat, []).append(f)
        return Response(categories)


class FeaturePresetViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        from apps.market_data.models import FeaturePreset
        return FeaturePreset.objects.filter(user=self.request.user).prefetch_related("features")

    def list(self, request):
        qs = self.get_queryset()
        data = []
        for p in qs:
            data.append({
                "id":       str(p.id),
                "name":     p.name,
                "features": [{"id": str(f.id), "name": f.name} for f in p.features.all()],
            })
        return Response(data)

    def create(self, request):
        from apps.market_data.models import FeaturePreset, FeatureDefinition
        name        = request.data.get("name")
        feature_ids = request.data.get("feature_ids", [])
        preset = FeaturePreset.objects.create(user=request.user, name=name)
        for fid in feature_ids:
            try:
                preset.features.add(FeatureDefinition.objects.get(id=fid))
            except Exception:
                pass
        return Response({"id": str(preset.id), "name": preset.name}, status=201)

    def destroy(self, request, pk=None):
        from apps.market_data.models import FeaturePreset
        FeaturePreset.objects.filter(id=pk, user=request.user).delete()
        return Response(status=204)


class OHLCVView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from apps.market_data.models import OHLCVBar
        ticker = request.query_params.get("ticker", "2603.TW")
        start  = request.query_params.get("start")
        end    = request.query_params.get("end")
        qs = OHLCVBar.objects.filter(ticker=ticker)
        if start: qs = qs.filter(timestamp__gte=start)
        if end:   qs = qs.filter(timestamp__lte=end)
        data = list(qs.order_by("timestamp").values(
            "timestamp","open","high","low","close","adj_close","volume"))
        return Response(data)
