<?php
/**
 * Plugin Name: Savoir Article Schema
 * Description: Stores reviewed Article JSON-LD through the WordPress REST API.
 * Version: 1.0.0
 */
defined('ABSPATH') || exit;
add_action('init', function () {
    register_post_meta('post', 'savoir_schema_json', array(
        'single' => true, 'type' => 'string', 'show_in_rest' => true,
        'auth_callback' => function ($allowed, $key, $post_id) { return current_user_can('edit_post', $post_id); },
        'sanitize_callback' => function ($value) {
            $schema = json_decode($value, true);
            if (!is_array($schema) || ($schema['@type'] ?? '') !== 'Article') return '';
            return wp_json_encode(array('@context' => 'https://schema.org', '@type' => 'Article',
                'headline' => sanitize_text_field($schema['headline'] ?? ''),
                'description' => sanitize_text_field($schema['description'] ?? '')));
        },
    ));
});
add_action('wp_head', function () {
    if (!is_singular('post')) return;
    $schema = json_decode(get_post_meta(get_queried_object_id(), 'savoir_schema_json', true), true);
    if (is_array($schema) && ($schema['@type'] ?? '') === 'Article') {
        echo '<script type="application/ld+json">' . wp_json_encode($schema, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . '</script>';
    }
});
