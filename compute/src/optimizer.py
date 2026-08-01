"""
Core Optimisation Logic - Dispatcher for different optimisation strategies
"""
from typing import Dict, List, Any, Optional

from fatigue_optimizer import (
    optimize_with_fatigue,
    NormTaskLock,
    OptimizationConfig,
    OptimizationResult,
)
from flow_checker import NormalizedFlowInput


def run_optimization(
    normalized_input: NormalizedFlowInput,
    strategy: str = "fatigue",
    task_locks: Optional[List[NormTaskLock]] = None,
    config: Optional[OptimizationConfig] = None
) -> OptimizationResult:
    """
    Main optimisation function - dispatches to specific optimisation strategy
    
    Args:
        normalized_input: NormalisedFlowInput with persons, tasks, transfers, floating_tasks
        strategy: Optimisation strategy ("fatigue" for fatigue minimisation)
        task_locks: Optional task locking constraints
        config: Optimisation configuration
    
    Returns:
        OptimizationResult with assignments and metrics
    """
    if strategy == "fatigue":
        return optimize_with_fatigue(normalized_input, task_locks, config)
    else:
        raise ValueError(f"Unknown optimisation strategy: {strategy}")


def fetch_event_data(backend_url: str, event_id: int) -> Dict[str, Any]:
    """
    Fetch all necessary data for optimisation from backend
    
    Args:
        backend_url: Backend API URL
        event_id: Event ID to optimise
    
    Returns:
        Event data dictionary
    """
    # TODO: Implement data fetching from backend API
    pass


def validate_optimization_result(result: OptimizationResult) -> bool:
    """
    Validate that optimisation results are feasible
    
    - Check for conflicts
    - Verify capability requirements
    - Check time constraints
    
    Args:
        result: OptimizationResult from optimisation
    
    Returns:
        True if valid, False otherwise
    """
    # TODO: Implement validation logic
    return True
