use rtk_proxy::budget::BudgetTracker;
use rtk_proxy::policy::{BudgetConfig, CircuitBreakerConfig};

fn test_budget_config() -> BudgetConfig {
    BudgetConfig {
        max_commands_per_session: 5,
        max_cpu_seconds: 60,
        loop_threshold: 3,
        loop_window_seconds: 10,
    }
}

fn test_circuit_breaker_config() -> CircuitBreakerConfig {
    CircuitBreakerConfig {
        max_consecutive_failures: 3,
        action: "suspend".to_string(),
    }
}

#[test]
fn test_budget_allows_commands_within_limit() {
    let mut tracker = BudgetTracker::new(&test_budget_config(), &test_circuit_breaker_config());
    for i in 0..5 {
        assert!(tracker.check_and_record(&format!("cmd-{i}"), 1).is_ok());
    }
    assert!(tracker.check_and_record("cmd-extra", 1).is_err());
}

#[test]
fn test_loop_detection() {
    let mut tracker = BudgetTracker::new(&test_budget_config(), &test_circuit_breaker_config());
    assert!(tracker.check_and_record("cargo test", 1).is_ok());
    assert!(tracker.check_and_record("cargo test", 1).is_ok());
    assert!(tracker.check_and_record("cargo test", 1).is_ok());
    assert!(tracker.check_and_record("cargo test", 1).is_err());
}

#[test]
fn test_circuit_breaker_triggers_on_consecutive_failures() {
    let mut tracker = BudgetTracker::new(&test_budget_config(), &test_circuit_breaker_config());
    tracker.record_failure();
    tracker.record_failure();
    tracker.record_failure();
    assert!(tracker.is_circuit_open());
}

#[test]
fn test_circuit_breaker_resets_on_success() {
    let mut tracker = BudgetTracker::new(&test_budget_config(), &test_circuit_breaker_config());
    tracker.record_failure();
    tracker.record_failure();
    tracker.record_success();
    assert!(!tracker.is_circuit_open());
}

#[test]
fn test_remaining_budget() {
    let mut tracker = BudgetTracker::new(&test_budget_config(), &test_circuit_breaker_config());
    let budget = tracker.remaining();
    assert_eq!(budget.commands_remaining, 5);
    assert_eq!(budget.cpu_seconds_remaining, 60);

    tracker.check_and_record("cargo test", 5).unwrap();
    let budget = tracker.remaining();
    assert_eq!(budget.commands_remaining, 4);
    assert_eq!(budget.cpu_seconds_remaining, 55);
}
