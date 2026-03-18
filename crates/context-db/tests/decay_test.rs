use context_db::decay;

#[test]
fn test_confidence_decay_no_churn() {
    let conf = decay::compute_confidence(0.8, 0, 15);
    assert!((conf - 0.8).abs() < 0.001);
}

#[test]
fn test_confidence_decay_some_churn() {
    let conf = decay::compute_confidence(0.8, 5, 15);
    let expected = 0.8 * (1.0 - 5.0 / 15.0);
    assert!((conf - expected).abs() < 0.001);
}

#[test]
fn test_confidence_decay_full_churn() {
    let conf = decay::compute_confidence(0.8, 15, 15);
    assert!((conf - 0.0).abs() < 0.001);
    let conf = decay::compute_confidence(0.8, 20, 15);
    assert!((conf - 0.0).abs() < 0.001);
}

#[test]
fn test_confidence_decay_custom_normalizer() {
    let conf = decay::compute_confidence(1.0, 5, 10);
    assert!((conf - 0.5).abs() < 0.001);
}
